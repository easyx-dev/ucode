import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSdk, connect } from "@ucode/sdk";
import { createClient as createHttpClient } from "@ucode/sdk/http";
import { createHttpBinding, createService, type Service, servicePaths } from "@ucode/service";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeProvider,
  startFakeProvider,
} from "../packages/service/src/testing/fake-provider.ts";

/**
 * sdk 经真实 HTTP + SSE 的端到端测试（浏览器用的是同一条路径）。
 *
 * 与 tests/e2e.test.ts 的区别：那边是"纯协议客户端 + 进程"，验证协议与绑定；
 * 这边验证 **sdk 本身**——请求-应答配对、事件折叠、断线重连与带游标续传。
 */

let core: Service | undefined;
let binding: ReturnType<typeof createHttpBinding> | undefined;
let provider: FakeProvider | undefined;
let dataDir: string | undefined;
let sdk: AgentSdk | undefined;

afterEach(async () => {
  await sdk?.close();
  sdk = undefined;
  await binding?.stop();
  binding = undefined;
  await core?.close();
  core = undefined;
  await provider?.close();
  provider = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function setup(): Promise<{ sdk: AgentSdk; baseUrl: string }> {
  provider = await startFakeProvider({ defaultReply: { text: "来自假模型的回答。" } });
  dataDir = await mkdtemp(join(tmpdir(), "sdk-http-"));
  await provider.writeModelsJson(servicePaths(dataDir).piDir);
  core = await createService({ dataDir, cwd: dataDir });
  binding = createHttpBinding(core, { port: 0 });
  await binding.start();
  const baseUrl = binding.endpoint ?? "";
  sdk = await connect({
    transport: createHttpClient({ baseUrl, clientId: "sdk-test", reconnectDelayMs: 100 }),
    clientId: "sdk-test",
    clientKind: "web",
    capabilities: [
      "sessions.read",
      "sessions.write",
      "prompt.run",
      "interaction.respond",
      "autonomy.unattended",
    ],
  });
  await sdk.connect();
  return { sdk, baseUrl };
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 20_000,
  description = "条件",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`等待${description}超时`));
      }
    }, 25);
  });
}

describe("sdk 经 HTTP + SSE", () => {
  it("握手 → 建会话 → 挂载 → 对话 → 折叠出可展示的消息", async () => {
    const { sdk: client } = await setup();
    expect(client.state.connected).toBe(true);
    expect(client.state.trustLevel).toBe("local");

    const created = await client.createSession({});
    expect(client.state.activeSessionId).toBe(created.sessionId);

    const attached = await client.attachSession(created.sessionId);
    expect(attached.readOnly).toBe(false);

    await client.prompt(created.sessionId, "你好");
    await waitUntil(
      () =>
        client.state.views[created.sessionId]?.running === false &&
        (client.state.views[created.sessionId]?.maxSeq ?? 0) > 0,
      25_000,
      "一轮结束",
    );

    const view = client.state.views[created.sessionId];
    expect(view?.entries.length).toBeGreaterThan(0);
    const messages = client.displayMessages(created.sessionId);
    expect(
      messages.some((message) => message.role === "user" && message.text.includes("你好")),
    ).toBe(true);
    expect(messages.some((message) => message.role === "assistant")).toBe(true);
    // 权威记录到达后，非权威的流式尾巴必须被清掉（否则会重复显示）
    expect(view?.streaming.text).toBe("");
    expect(client.state.views[created.sessionId]?.summary?.entryCount ?? 0).toBeGreaterThan(0);
  });

  it("命令面的返回形状与控制层读到的一致（stats.usage 曾因此永远空着）", async () => {
    const { sdk } = await setup();
    const usage = await sdk.usageStats();
    // 曾经的真实缺陷：服务端回 `{ usage }`、SDK/UI 读 `{ summary }`，两边都"没报错"，
    // 用量面板却一直空着。断言形状而不是数值——数值取决于假供应商是否报用量。
    expect(typeof usage.summary).toBe("object");
    expect(typeof usage.summary.records).toBe("number");
    expect(typeof usage.readable).toBe("string");

    const providers = await sdk.listProviders();
    expect(Array.isArray(providers.providers)).toBe(true);
    expect(typeof providers.configFile).toBe("string");

    const models = await sdk.listModels();
    expect(Array.isArray(models)).toBe(true);
    // 服务刚起来也不能是空列表：模型选择器会因此看起来"没有模型可用"
    expect(models.length).toBeGreaterThan(0);
  });

  it("断线重连：带游标补齐缺口，不丢不重", async () => {
    const { sdk: client, baseUrl } = await setup();
    const created = await client.createSession({});
    await client.attachSession(created.sessionId);
    await client.prompt(created.sessionId, "第一句");
    // 等这一轮**结束**再断开：这里模拟的是"壳在空闲时断开"（运行中发消息会排队进下一轮）
    await waitUntil(
      () =>
        (client.state.views[created.sessionId]?.maxSeq ?? 0) > 0 &&
        client.state.views[created.sessionId]?.running === false,
      30_000,
      "第一轮结束",
    );
    const cursorBefore = client.state.views[created.sessionId]?.maxSeq ?? 0;
    const entriesBefore = client.state.views[created.sessionId]?.entries.length ?? 0;

    // 断开事件流：模拟"壳与服务层之间的连接断了"
    await client.close();

    // 期间服务层继续产生记录（用另一条连接驱动第二轮）
    const { sdk: other } = await (async () => {
      const second = await connect({
        transport: createHttpClient({ baseUrl, clientId: "sdk-other" }),
        clientId: "sdk-other",
        clientKind: "test",
        capabilities: ["sessions.read", "prompt.run", "interaction.respond"],
      });
      await second.connect();
      await second.attachSession(created.sessionId);
      await second.prompt(created.sessionId, "第二句");
      await waitUntil(
        () => (second.state.views[created.sessionId]?.maxSeq ?? 0) > cursorBefore,
        25_000,
        "第二轮落盘",
      );
      return { sdk: second };
    })();

    // 原壳重连：带游标续传
    const resumed = await connect({
      transport: createHttpClient({ baseUrl, clientId: "sdk-test", reconnectDelayMs: 100 }),
      clientId: "sdk-test",
      clientKind: "web",
      capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
    });
    await resumed.connect();
    await resumed.attachSession(created.sessionId);
    await resumed.getEntries(created.sessionId, cursorBefore);

    sdk = resumed;
    const view = resumed.state.views[created.sessionId];
    expect(view?.maxSeq ?? 0).toBeGreaterThan(cursorBefore);
    expect(view?.entries.length ?? 0).toBeGreaterThan(entriesBefore);
    // 去重：重放/续传重复投递同一条记录不应产生重复行
    const ids = new Set((view?.entries ?? []).map((entry) => entry.id));
    expect(ids.size).toBe(view?.entries.length);

    await other.close();
  });
});
