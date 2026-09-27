import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentSdk, connect } from "@ucode/sdk";
import { createClient as createHttpClient } from "@ucode/sdk/http";
import { createClient as createRpcClient } from "@ucode/sdk/rpc";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeProvider,
  startFakeProvider,
} from "../packages/core/src/testing/fake-provider.ts";

/**
 * 服务（BS 架构）的端到端验收：`service` 子命令起的是常驻的唯一后端，壳都是客户端。
 *
 * 这一组用例覆盖三件只有真起进程才能验的事：
 * 1. 拉起后**独立存活**（父进程退出它还在），停止时清理干净；
 * 2. 被 `kill -9` 留下陈旧注册/锁/socket 后，下一次仍能恢复（否则这个数据层就再也起不来了）；
 * 3. 两个壳连同一个服务打开同一个会话：一端发消息另一端**实时看到**，且运行中发消息是
 *    **排队**而不是报错——这正是"一个对话，所有人都能发（空闲时）"的验收口径。
 */

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_ENTRY = join(ROOT, "apps", "cli", "src", "main.ts");

type Registration = {
  pid: number;
  coreId: string;
  dataDir: string;
  endpoints: { unix?: string; http?: string };
};

const tempDirs: string[] = [];
const services = new Set<number>();
const sdks: AgentSdk[] = [];
const providers: FakeProvider[] = [];

afterEach(async () => {
  for (const sdk of sdks.splice(0)) await sdk.close().catch(() => undefined);
  for (const provider of providers.splice(0)) await provider.close();
  for (const pid of services) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已经退出了
    }
  }
  services.clear();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function makeEnv(): Promise<{ dataDir: string; runDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "svc-data-"));
  const runDir = await mkdtemp(join(tmpdir(), "svc-run-"));
  tempDirs.push(dataDir, runDir);
  return { dataDir, runDir };
}

/** 跑一次 CLI 并等它退出（`service start` 不带 --foreground 时会自己返回）。 */
function runCli(args: string[], runDir: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--conditions=dev-src", CLI_ENTRY, ...args], {
      cwd: ROOT,
      env: { ...process.env, UCODE_RUNTIME_DIR: runDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => resolveRun({ code: code ?? 0, stderr }));
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function registrationOf(runDir: string): Promise<Registration | undefined> {
  const files = await readdir(runDir).catch(() => []);
  const file = files.find((name) => name.startsWith("service-") && name.endsWith(".json"));
  if (file === undefined) return undefined;
  try {
    return JSON.parse(await readFile(join(runDir, file), "utf8")) as Registration;
  } catch {
    return undefined;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function waitForRegistration(runDir: string, timeoutMs = 15_000): Promise<Registration> {
  await waitUntil(
    async () => (await registrationOf(runDir)) !== undefined,
    timeoutMs,
    "服务注册文件出现",
  );
  const registration = await registrationOf(runDir);
  if (registration === undefined) throw new Error("注册文件读不到");
  services.add(registration.pid);
  return registration;
}

async function startService(runDir: string, dataDir: string): Promise<Registration> {
  const started = await runCli(
    ["service", "start", "--data-dir", dataDir, "--cwd", dataDir, "--port", "0"],
    runDir,
  );
  expect(started.code, started.stderr).toBe(0);
  return waitForRegistration(runDir);
}

function track<T extends AgentSdk>(sdk: T): T {
  sdks.push(sdk);
  return sdk;
}

const CLIENT_CAPABILITIES = [
  "sessions.read",
  "sessions.write",
  "prompt.run",
  "interaction.respond",
  "autonomy.unattended",
] as const;

describe("服务：生命周期与发现", () => {
  it("拉起后独立存活：注册文件给出端点，父进程退出服务仍在，stop 后清理", async () => {
    const { dataDir, runDir } = await makeEnv();
    const registration = await startService(runDir, dataDir);

    // 独立存活：runCli 的父进程已经退出了，服务进程还在
    expect(isAlive(registration.pid)).toBe(true);
    expect(registration.dataDir).toBe(dataDir);
    // socket 落在运行时目录（而不是数据层目录：那是会被迁移与支持包带走的地方）
    expect(registration.endpoints.unix?.startsWith(runDir)).toBe(true);
    expect(registration.endpoints.unix?.endsWith(".sock")).toBe(true);
    expect(registration.endpoints.http).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);

    // 注册文件与 socket 都不该对同组/其他用户开放
    const files = await readdir(runDir);
    const registryFile = files.find((name) => name.endsWith(".json"));
    expect(registryFile).toBeDefined();
    const mode = statSync(join(runDir, registryFile as string)).mode & 0o777;
    expect(mode & 0o077).toBe(0);

    // 状态查询走真实握手（顺带证明端点可用）
    const status = await runCli(["service", "status", "--data-dir", dataDir], runDir);
    expect(status.code, status.stderr).toBe(0);
    expect(status.stderr).toContain("服务运行中");
    expect(status.stderr).toContain("会话数");

    const stopped = await runCli(["service", "stop", "--data-dir", dataDir], runDir);
    expect(stopped.code, stopped.stderr).toBe(0);
    await waitUntil(() => !isAlive(registration.pid), 10_000, "服务退出");
    services.delete(registration.pid);

    // 注册与锁都清掉了（不留"看起来还在跑"的残骸）；日志留下供排查
    const left = await readdir(runDir);
    expect(left.some((name) => name.endsWith(".json"))).toBe(false);
    expect(left.some((name) => name.endsWith(".lock"))).toBe(false);
    expect(left.some((name) => name.endsWith(".log"))).toBe(true);
  });

  it("被 kill -9 留下陈旧注册后仍能恢复（否则这个数据层再也起不来）", async () => {
    const { dataDir, runDir } = await makeEnv();
    const first = await startService(runDir, dataDir);

    process.kill(first.pid, "SIGKILL");
    await waitUntil(() => !isAlive(first.pid), 10_000, "旧服务退出");
    services.delete(first.pid);

    // 只看 pid 会犯"pid 复用"的错；这里靠端点探测判死
    const status = await runCli(["service", "status", "--data-dir", dataDir], runDir);
    expect(status.code).toBe(1);
    expect(status.stderr).toContain("服务未运行");

    const second = await startService(runDir, dataDir);
    expect(second.pid).not.toBe(first.pid);
    expect(isAlive(second.pid)).toBe(true);
  });
});

describe("服务：多壳打开同一个会话", () => {
  it("一端发消息另一端实时看到；运行中发消息排队进下一轮而不是报错", async () => {
    const provider = await startFakeProvider();
    providers.push(provider);
    const { dataDir, runDir } = await makeEnv();
    await provider.writeModelsJson(dataDir);

    // 第一轮故意卡在"工具批准"上：会话因此确定性地处于运行中，
    // 不必靠时间窗口去赌"另一头发消息时它还在跑"。
    provider.queue([
      {
        text: "我来写一个文件。",
        toolCalls: [{ name: "write", args: { path: join(dataDir, "queued.txt"), content: "hi" } }],
      },
    ]);

    const registration = await startService(runDir, dataDir);
    const socketPath = registration.endpoints.unix;
    const baseUrl = registration.endpoints.http;
    expect(socketPath, "服务应提供 unix socket").toBeDefined();
    expect(baseUrl, "服务应提供 http 端点").toBeDefined();

    // 两个壳：一个走 unix socket（TUI 的路子），一个走 HTTP（浏览器的路子）
    const tui = track(
      await connect({
        transport: createRpcClient({ socketPath: socketPath as string }),
        clientId: "tui",
        clientKind: "tui",
        capabilities: [...CLIENT_CAPABILITIES],
      }),
    );
    const web = track(
      await connect({
        transport: createHttpClient({ baseUrl: baseUrl as string, clientId: "web" }),
        clientId: "web",
        clientKind: "web",
        capabilities: [...CLIENT_CAPABILITIES],
      }),
    );
    await tui.connect();
    await web.connect();

    const created = await tui.createSession({ cwd: dataDir });
    await tui.attachSession(created.sessionId);
    await web.attachSession(created.sessionId);

    await tui.prompt(created.sessionId, "第一句");
    await waitUntil(() => tui.state.interactions.length > 0, 20_000, "批准请求到达第一个壳");
    const request = tui.state.interactions[0];
    expect(request).toBeDefined();
    // 同一会话的多个壳都收到同一条交互请求（广播，不是择一）
    await waitUntil(
      () => web.state.interactions.some((item) => item.id === request?.id),
      10_000,
      "批准请求广播到第二个壳",
    );

    // 运行中从另一头发消息：排队，不是 session_not_owned / session_busy
    const queued = await web.prompt(created.sessionId, "第二句");
    expect(queued.queued).toBe(true);
    expect(queued.pendingMessages).toBeGreaterThan(0);

    // 队列计数经状态事件广播：发起方之外的壳也看得到
    await waitUntil(
      () => (tui.state.views[created.sessionId]?.state?.pendingMessages ?? 0) > 0,
      10_000,
      "队列计数到达另一个壳",
    );

    // 批准 → 这一轮跑完 → 排队的消息作为下一轮被执行
    // 走 ui.response（实时交互），不是 interaction.resolve（那是无人值守下的持久化待决）
    tui.respondToInteraction(request?.id ?? "", "允许一次");
    await waitUntil(
      () => (web.state.views[created.sessionId]?.state?.status ?? "idle") === "idle",
      30_000,
      "第一轮结束",
    );
    await waitUntil(
      () =>
        web
          .displayMessages(created.sessionId)
          .some((message) => message.role === "user" && message.text.includes("第二句")),
      30_000,
      "排队的那条成为下一轮",
    );
    await waitUntil(
      () =>
        (tui.state.views[created.sessionId]?.state?.pendingMessages ?? 0) === 0 &&
        (web.state.views[created.sessionId]?.state?.pendingMessages ?? 0) === 0,
      30_000,
      "队列清空",
    );

    // 两端看到的是同一份历史
    const texts = (sdk: AgentSdk): string[] =>
      sdk
        .displayMessages(created.sessionId)
        .filter((message) => message.role === "user")
        .map((message) => message.text);
    expect(texts(tui)).toEqual(texts(web));
    expect(texts(web).join("|")).toContain("第一句");
    expect(texts(web).join("|")).toContain("第二句");
    expect(existsSync(join(dataDir, "queued.txt"))).toBe(true);
  }, 90_000);
});
