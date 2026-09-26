import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  type FakeProvider,
  startFakeProvider,
} from "../packages/core/src/testing/fake-provider.ts";

/**
 * 端到端验收（spec §7.3 的 CI 任务 1，进程级版本）：
 *
 * 空目录里只起**核心层进程**（不装任何壳），用**纯协议客户端**（不依赖 sdk、直接按协议收发）
 * 完成：握手 → 新建会话 → 发起对话 → 收到完整事件流 → 取回历史校验。
 *
 * 模型调用走本地假供应商，因此不依赖真实模型、可重复跑。
 * 传输分别覆盖 stdio（JSONL 按字节切分）与 HTTP（SSE 下行 + POST 上行）。
 */

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_ENTRY = join(ROOT, "apps", "cli", "src", "main.ts");

const children: ChildProcess[] = [];
const tempDirs: string[] = [];
const providers: FakeProvider[] = [];
const aborts: AbortController[] = [];

afterAll(async () => {
  for (const controller of aborts) controller.abort();
  for (const child of children) child.kill();
  for (const instance of providers) await instance.close();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function trackProvider(instance: FakeProvider): FakeProvider {
  providers.push(instance);
  return instance;
}

async function makeDataDir(providerInstance: FakeProvider): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "e2e-data-"));
  tempDirs.push(dir);
  await providerInstance.writeModelsJson(dir);
  return dir;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

function spawnCore(args: string[]): { child: ChildProcess; stderr: () => string } {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let stderrText = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrText += chunk.toString("utf8");
  });
  return { child, stderr: () => stderrText };
}

/** 纯协议客户端：只认 JSONL 与协议消息，不 import 任何内部包。 */
function createLineClient(child: ChildProcess) {
  const received: Record<string, unknown>[] = [];
  const waiters: {
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }[] = [];
  let buffer: Buffer = Buffer.alloc(0);

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
    for (;;) {
      const index = buffer.indexOf(0x0a);
      if (index === -1) break;
      const line = buffer.subarray(0, index).toString("utf8").trim();
      buffer = buffer.subarray(index + 1);
      if (line === "") continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      received.push(message);
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex !== -1) {
        const waiter = waiters.splice(waiterIndex, 1)[0];
        waiter?.resolve(message);
      }
    }
  });

  const waitFor = (
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs = 20_000,
    description = "消息",
  ): Promise<Record<string, unknown>> =>
    new Promise((resolveWait, reject) => {
      const existing = received.find(predicate);
      if (existing !== undefined) {
        resolveWait(existing);
        return;
      }
      const waiter = { predicate, resolve: resolveWait };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(
          new Error(
            `等待${description}超时；已收到：${received.map((m) => String(m.type)).join(", ")}`,
          ),
        );
      }, timeoutMs).unref?.();
    });

  let counter = 0;
  return {
    received,
    waitFor,
    send(message: Record<string, unknown>): void {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    },
    async command(
      command: string,
      sessionId: string | null,
      args: unknown = {},
    ): Promise<Record<string, unknown>> {
      const id = `c${++counter}`;
      this.send({ type: "command", id, command, sessionId, args });
      const response = await waitFor(
        (message) => message.type === "response" && message.id === id,
        20_000,
        `${command} 的应答`,
      );
      return response;
    },
  };
}

describe("端到端：核心层进程 + 纯协议客户端（stdio）", () => {
  it("握手 → 建会话 → 对话 → 完整事件流 → 取回历史", async () => {
    const provider = trackProvider(
      await startFakeProvider({ defaultReply: { text: "这是假模型的回答。" } }),
    );
    const dataDir = await makeDataDir(provider);
    const { child, stderr } = spawnCore([
      "core",
      "start",
      "--binding",
      "stdio",
      "--data-dir",
      dataDir,
    ]);
    const client = createLineClient(child);

    // 1. 握手：能力声明与授予分离，版本双向校验
    client.send({
      type: "hello",
      protocolVersion: 1,
      clientId: "pure-client",
      clientKind: "test",
      binding: "stdio",
      capabilities: [
        "sessions.read",
        "sessions.write",
        "prompt.run",
        "interaction.respond",
        "autonomy.unattended",
      ],
    });
    const welcome = await client.waitFor(
      (message) => message.type === "welcome",
      20_000,
      "welcome",
    );
    expect(welcome.protocolVersion).toBe(1);
    expect(welcome.trustLevel).toBe("implicit");
    expect((welcome.grantedCapabilities as string[]).includes("prompt.run")).toBe(true);

    // 2. 新建会话
    const created = await client.command("session.create", null, { cwd: dataDir });
    expect(created.success, JSON.stringify(created.error ?? {})).toBe(true);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const attached = await client.command("session.attach", sessionId);
    expect(attached.success).toBe(true);

    // 3. 一轮对话：事件流必须完整
    const prompted = await client.command("prompt", sessionId, { text: "你好" });
    expect(prompted.success).toBe(true);
    await client.waitFor((message) => message.type === "agent_settled", 30_000, "agent_settled");

    const types = client.received.map((message) => String(message.type));
    expect(types).toContain("turn_start");
    expect(types).toContain("message_delta");
    expect(types).toContain("entry_appended");
    expect(types).toContain("turn_end");
    expect(types).toContain("agent_settled");

    // 4. 取回历史：记录带游标（行序号），且在磁盘上（权威）
    const history = await client.command("session.get_entries", sessionId, { fromSeq: 0 });
    expect(history.success).toBe(true);
    const records = (history.data as { records: { seq: number }[] }).records;
    expect(records.length).toBeGreaterThan(0);
    expect(Math.min(...records.map((record) => record.seq))).toBeGreaterThanOrEqual(1);

    const indexEntry = client.received.find(
      (message) =>
        message.type === "entry_appended" &&
        (message.entry as { type?: string }).type === "message",
    );
    expect(indexEntry, "应收到带完整记录的事件").toBeTruthy();

    // 5. 退出码与日志：进程仍在跑（stdio 绑定的正常状态），日志不污染 stdout
    expect(stderr()).toContain("核心层就绪");
    child.kill("SIGTERM");
  }, 60_000);
});

describe("端到端：核心层进程 + HTTP/SSE（下行推、上行 POST）", () => {
  it("同一套命令经 HTTP 绑定得到一致的会话状态", async () => {
    const provider = trackProvider(
      await startFakeProvider({ defaultReply: { text: "经 HTTP 的回答。" } }),
    );
    const dataDir = await makeDataDir(provider);
    const port = await freePort();
    const { child, stderr } = spawnCore([
      "core",
      "start",
      "--binding",
      "http",
      "--port",
      String(port),
      "--data-dir",
      dataDir,
    ]);

    // 等它就绪（stderr 上会打印对端地址）
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`核心层未就绪：${stderr()}`)), 20_000);
      const check = setInterval(() => {
        if (stderr().includes("核心层就绪")) {
          clearInterval(check);
          clearTimeout(timer);
          resolveReady();
        }
      }, 50);
      timer.unref?.();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    console.log("[e2e-http] 就绪，baseUrl =", baseUrl);
    const clientId = "http-pure-client";
    const events: Record<string, unknown>[] = [];
    const waiters: {
      predicate: (message: Record<string, unknown>) => boolean;
      resolve: (m: Record<string, unknown>) => void;
    }[] = [];

    const streamAbort = new AbortController();
    aborts.push(streamAbort);
    const stream = await Promise.race([
      fetch(`${baseUrl}/events?clientId=${clientId}`, { signal: streamAbort.signal }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error(`打开事件流超时。核心层 stderr：\n${stderr()}`)), 8_000),
      ),
    ]);
    expect(stream.ok, `事件流返回 ${stream.status}；核心层 stderr：\n${stderr()}`).toBe(true);
    const reader = stream.body?.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    void (async () => {
      for (;;) {
        let chunk: { value?: Uint8Array; done?: boolean };
        try {
          chunk = (await reader!.read()) ?? { done: true };
        } catch {
          return; // 对端关闭（进程退出或收尾）不算错误
        }
        const { value, done } = chunk;
        pending += decoder.decode(value, { stream: true });
        let boundary = pending.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data !== "") {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            events.push(parsed);
            const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(parsed));
            if (waiterIndex !== -1) waiters.splice(waiterIndex, 1)[0]?.resolve(parsed);
          }
          boundary = pending.indexOf("\n\n");
        }
      }
    })();

    const waitFor = (
      predicate: (message: Record<string, unknown>) => boolean,
      timeoutMs = 20_000,
    ): Promise<Record<string, unknown>> =>
      new Promise((resolveWait, reject) => {
        const existing = events.find(predicate);
        if (existing !== undefined) {
          resolveWait(existing);
          return;
        }
        const waiter = { predicate, resolve: resolveWait };
        waiters.push(waiter);
        setTimeout(
          () =>
            reject(
              new Error(
                `HTTP 事件超时；已收到：${events.map((m) => String(m.type)).join(", ")}；核心层 stderr：\n${stderr()}`,
              ),
            ),
          timeoutMs,
        );
      });

    const post = async (message: Record<string, unknown>): Promise<void> => {
      const response = await fetch(`${baseUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(202);
    };

    console.log("[e2e-http] 准备 POST hello");
    await post({
      type: "hello",
      protocolVersion: 1,
      clientId,
      clientKind: "web",
      binding: "http",
      capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
    });
    console.log("[e2e-http] 等待 welcome");
    const welcome = await waitFor((message) => message.type === "welcome");
    console.log("[e2e-http] 收到 welcome");
    expect(welcome.trustLevel).toBe("local");

    let counter = 0;
    const command = async (
      name: string,
      args: unknown,
      sessionId: string | null,
    ): Promise<Record<string, unknown>> => {
      const id = `h${++counter}`;
      await post({ type: "command", id, command: name, sessionId, args });
      return waitFor((message) => message.type === "response" && message.id === id);
    };

    console.log("[e2e-http] session.create");
    const created = await command("session.create", { cwd: dataDir }, null);
    expect(created.success, JSON.stringify(created.error ?? {})).toBe(true);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    console.log("[e2e-http] session.attach");
    await command("session.attach", {}, sessionId);
    console.log("[e2e-http] prompt");
    await command("prompt", { text: "经 HTTP 打招呼" }, sessionId);
    console.log("[e2e-http] 等 agent_settled");
    await waitFor((message) => message.type === "agent_settled", 15_000);
    console.log("[e2e-http] settled");

    console.log("[e2e-http] 取历史");
    const history = await command("session.get_entries", { fromSeq: 0 }, sessionId);
    const records = (history.data as { records: unknown[] }).records;
    expect(records.length).toBeGreaterThan(0);
    console.log("[e2e-http] 历史 OK，收尾");
    streamAbort.abort();
    child.kill("SIGTERM");
    if (child.exitCode === null) {
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
    console.log("[e2e-http] 子进程已退出");
  }, 30_000);
});
