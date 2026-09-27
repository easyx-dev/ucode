import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@ucode/protocol";
import { createHttpBinding, createService, type Service, servicePaths } from "@ucode/service";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeProvider,
  startFakeProvider,
} from "../packages/service/src/testing/fake-provider.ts";

/**
 * HTTP + SSE 绑定的线格式与配对测试（进程内）。
 *
 * 验三件事：
 * 1. 下行 SSE 推、上行 POST 提交，按 `x-client-id` 配对到同一条协议 C 连接；
 * 2. 纯请求-应答的传输上，交互面的**配对**成立（服务层发 ui.request，控制层 POST 回 ui.response）；
 * 3. 暴露面规则生效：监听非环回且未显式声明 → **拒绝启动**（spec §5.3）。
 */

let core: Service | undefined;
let binding: ReturnType<typeof createHttpBinding> | undefined;
let provider: FakeProvider | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  await binding?.stop();
  binding = undefined;
  await core?.close();
  core = undefined;
  await provider?.close();
  provider = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

type Harness = {
  baseUrl: string;
  events: Record<string, unknown>[];
  waitFor: (
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown>>;
  post: (message: Record<string, unknown>) => Promise<number>;
  command: (
    name: string,
    args: unknown,
    sessionId: string | null,
  ) => Promise<Record<string, unknown>>;
  stop: () => Promise<void>;
};

async function startHarness(
  options: { staticDir?: string; reply?: string; interactionTimeoutMs?: number } = {},
): Promise<Harness> {
  provider = await startFakeProvider({ defaultReply: { text: options.reply ?? "HTTP 回答。" } });
  dataDir = await mkdtemp(join(tmpdir(), "http-binding-"));
  await provider.writeModelsJson(servicePaths(dataDir).piDir);
  core = await createService({
    dataDir,
    cwd: dataDir,
    interactionTimeoutMs: options.interactionTimeoutMs ?? 2_000,
  });
  binding = createHttpBinding(core, {
    port: 0,
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  });
  await binding.start();
  const baseUrl = binding.endpoint ?? "";
  const clientId = "wire-test";

  const events: Record<string, unknown>[] = [];
  const waiters: {
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }[] = [];

  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/events?clientId=${clientId}`, {
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`事件流打不开：HTTP ${response.status}`);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  void (async () => {
    for (;;) {
      let chunk: { value?: Uint8Array; done?: boolean };
      try {
        chunk = (await reader?.read()) ?? { done: true };
      } catch {
        return; // 主动断开（测试收尾）不算错误
      }
      const { value, done } = chunk;
      if (done === true) break;
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
          const index = waiters.findIndex((waiter) => waiter.predicate(parsed));
          if (index !== -1) waiters.splice(index, 1)[0]?.resolve(parsed);
        }
        boundary = pending.indexOf("\n\n");
      }
    }
  })();

  const waitFor = (
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolveWait, reject) => {
      const existing = events.find(predicate);
      if (existing !== undefined) {
        resolveWait(existing);
        return;
      }
      const waiter = { predicate, resolve: resolveWait };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error(`等待超时；已收到：${events.map((m) => String(m.type)).join(", ")}`));
      }, timeoutMs);
    });

  const post = async (message: Record<string, unknown>): Promise<number> => {
    const posted = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      body: JSON.stringify(message),
    });
    return posted.status;
  };

  let counter = 0;
  const command = async (
    name: string,
    args: unknown,
    sessionId: string | null,
  ): Promise<Record<string, unknown>> => {
    const id = `t${++counter}`;
    await post({ type: "command", id, command: name, sessionId, args });
    return waitFor((message) => message.type === "response" && message.id === id);
  };

  return {
    baseUrl,
    events,
    waitFor,
    post,
    command,
    stop: async () => {
      controller.abort();
    },
  };
}

describe("HTTP + SSE 绑定", () => {
  it("/health 可用，且握手经 POST 上行、welcome 经 SSE 下行", async () => {
    const harness = await startHarness();
    const health = await fetch(`${harness.baseUrl}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; trustLevel: string };
    expect(body.ok).toBe(true);
    expect(body.trustLevel).toBe("local");

    expect(
      await harness.post({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: "wire-test",
        clientKind: "web",
        binding: "http",
        capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
      }),
    ).toBe(202);

    const welcome = await harness.waitFor((message) => message.type === "welcome");
    expect(welcome.trustLevel).toBe("local");
    await harness.stop();
  });

  it("一轮对话：SSE 收到事件流，历史可经命令取回", async () => {
    const harness = await startHarness({ reply: "通过 HTTP 说的话。" });
    await harness.post({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "wire-test",
      clientKind: "web",
      binding: "http",
      capabilities: ["sessions.read", "sessions.write", "prompt.run"],
    });
    await harness.waitFor((message) => message.type === "welcome");

    const created = await harness.command("session.create", { cwd: dataDir }, null);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await harness.command("session.attach", {}, sessionId);
    await harness.command("prompt", { text: "你好" }, sessionId);
    await harness.waitFor((message) => message.type === "agent_settled", 20_000);

    const types = harness.events.map((message) => String(message.type));
    expect(types).toContain("message_delta");
    expect(types).toContain("entry_appended");

    const history = await harness.command("session.get_entries", { fromSeq: 0 }, sessionId);
    const records = (history.data as { records: { seq: number }[] }).records;
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.seq).toBe(1);
    await harness.stop();
  });

  it("纯请求-应答传输上的交互配对：ui.request 下行，ui.response 上行", async () => {
    const harness = await startHarness({ reply: "写完了。" });
    await harness.post({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "wire-test",
      clientKind: "web",
      binding: "http",
      capabilities: [
        "sessions.read",
        "sessions.write",
        "prompt.run",
        "tools.direct",
        "interaction.respond",
      ],
    });
    await harness.waitFor((message) => message.type === "welcome");

    const created = await harness.command("session.create", { cwd: dataDir }, null);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await harness.command("session.attach", {}, sessionId);

    // 直接用 bash 直调触发不了闸门（它是工具直调路径），这里用 bash 命令本身即可验证配对：
    // 更贴近真实的是让模型发起改动类工具调用——假供应商支持脚本化工具调用。
    provider?.queue([
      {
        text: "我来写。",
        toolCalls: [
          { name: "write", args: { path: join(dataDir as string, "http.txt"), content: "ok" } },
        ],
      },
      { text: "完成。" },
    ]);
    await harness.command("prompt", { text: "写个文件" }, sessionId);

    const request = await harness.waitFor((message) => message.type === "ui.request", 20_000);
    expect(request.method).toBe("select");
    // 上行提交应答（纯请求-应答传输必须配对）
    expect(
      await harness.post({
        type: "ui.response",
        id: request.id,
        value: "允许一次",
        responderId: "wire-test",
      }),
    ).toBe(202);
    await harness.waitFor((message) => message.type === "agent_settled", 20_000);

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(dataDir as string, "http.txt"), "utf8")).toBe("ok");
    await harness.stop();
  });

  it("监听非环回且未显式声明：拒绝启动", async () => {
    provider = await startFakeProvider();
    dataDir = await mkdtemp(join(tmpdir(), "http-binding-"));
    await provider.writeModelsJson(servicePaths(dataDir).piDir);
    core = await createService({ dataDir, cwd: dataDir });
    expect(() => createHttpBinding(core as Service, { host: "0.0.0.0", port: 0 })).toThrow(
      /拒绝启动/,
    );
  });

  it("显式允许非环回：信任级别降为 untrusted（只读 + 对话）", async () => {
    provider = await startFakeProvider();
    dataDir = await mkdtemp(join(tmpdir(), "http-binding-"));
    await provider.writeModelsJson(servicePaths(dataDir).piDir);
    core = await createService({ dataDir, cwd: dataDir });
    const unsafe = createHttpBinding(core, { host: "0.0.0.0", port: 0, allowNonLoopback: true });
    expect(unsafe.trustLevel).toBe("untrusted");
    // 不 start（本地环境未必允许监听 0.0.0.0），只验证声明与信任级别
  });
});
