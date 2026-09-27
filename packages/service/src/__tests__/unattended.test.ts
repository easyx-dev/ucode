import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { servicePaths } from "../paths.ts";
import { createService, type Service } from "../service.ts";
import { type FakeProvider, startFakeProvider } from "../testing/fake-provider.ts";

/**
 * 无人值守的持久化待决交互（spec §2.7 / §4.11 / ADR-020）。
 *
 * 场景：会话在没有任何控制层看护时运行，触发权限请求——
 * 1. 请求**写入数据层**（而不是被丢弃或无限等待）；
 * 2. 当前这轮按策略拒绝（无人应答不放行）；
 * 3. **稍后有人来了**：任何通路应答后，决定转达给 agent，agent 继续工作；
 * 4. 重启后待决请求仍在（从记录里恢复）。
 */

const require = createRequire(import.meta.url);

let core: Service | undefined;
let provider: FakeProvider | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  await core?.close().catch(() => undefined);
  core = undefined;
  await provider?.close();
  provider = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 15_000,
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
    }, 50);
  });
}

describe("无人值守：持久化待决交互", () => {
  it("无应答者时落盘；稍后应答转达给 agent；agent 继续执行", async () => {
    provider = await startFakeProvider();
    provider.queue([
      {
        text: "我来写文件。",
        toolCalls: [{ name: "write", args: { path: "u.txt", content: "v1" } }],
      },
      // 应答后的新 prompt 轮：agent 应重试写文件
      {
        text: "好的，重试。",
        toolCalls: [{ name: "write", args: { path: "u.txt", content: "v1" } }],
      },
      { text: "已重试完成。" },
    ]);
    dataDir = await mkdtemp(join(tmpdir(), "unattended-"));
    await provider.writeModelsJson(servicePaths(dataDir).piDir);
    core = await createService({ dataDir, cwd: dataDir, interactionTimeoutMs: 1_000 });

    const messages: unknown[] = [];
    const handle = core.attachConnection({
      binding: "test",
      trustLevel: "implicit",
      send: (message) => messages.push(message),
    });
    await handle.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "u1",
      clientKind: "test",
      binding: "test",
      capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
    });

    // 1. 本机通路建会话后离开——场景：用户启动了任务，然后关掉了所有控制层
    await handle.receive({
      type: "command",
      id: "c1",
      command: "session.create",
      sessionId: null,
      args: { cwd: dataDir },
    });
    const created = messages.findLast(
      (message) => (message as { type: string }).type === "response",
    ) as { data?: { sessionId: string } };
    const sessionId = created.data?.sessionId as string;
    await handle.close();

    // 2. 无人值守的通路（未认证：不具批准权）驱动会话——权限请求无人应答
    const messages2: unknown[] = [];
    const untrusted = core.attachConnection({
      binding: "http",
      trustLevel: "untrusted",
      send: (message) => messages2.push(message),
    });
    await untrusted.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "u2",
      clientKind: "web",
      binding: "http",
      capabilities: ["sessions.read", "prompt.run"],
    });
    await untrusted.receive({
      type: "command",
      id: "u1",
      command: "session.attach",
      sessionId,
      args: {},
    });
    await untrusted.receive({
      type: "command",
      id: "u2",
      command: "prompt",
      sessionId,
      args: { text: "写个文件" },
    });
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    // 3. 待决请求落盘（ui.pending），本轮被拒（文件没有写）
    const repo = await core.store.openSession(sessionId);
    const entries = await repo?.entries();
    const pending = entries?.find(
      (entry) => entry.type === "custom" && entry.customType === "ui.pending",
    );
    expect(pending, "待决交互应已持久化").toBeTruthy();
    const { readFile } = await import("node:fs/promises");
    await expect(readFile(join(dataDir, "u.txt"), "utf8")).rejects.toThrow();
    const interactionId = (pending as unknown as { data: { interactionId: string } }).data
      .interactionId;

    // 4. 稍后有人来了（本机通路重新挂载）：应答持久化的待决交互
    // 假供应商此时补排"重试轮"的回复（第一轮已把队列消费完——agent 被拦后每 retries 一次
    // 就消费一条，这正是无人值守的真实形状）
    provider.queue([
      {
        text: "好的，重试。",
        toolCalls: [{ name: "write", args: { path: "u.txt", content: "v1" } }],
      },
      { text: "已重试完成。" },
    ]);
    const messages3: unknown[] = [];
    const later = core.attachConnection({
      binding: "test",
      trustLevel: "implicit",
      send: (message) => messages3.push(message),
    });
    await later.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "later",
      clientKind: "test",
      binding: "test",
      capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
    });
    await later.receive({
      type: "command",
      id: "l1",
      command: "session.attach",
      sessionId,
      args: {},
    });
    await later.receive({
      type: "command",
      id: "l2",
      command: "interaction.resolve",
      sessionId,
      args: { interactionId, value: true, cancelled: false },
    });

    // 5. agent 收到转达后重试写文件——重试时是 confirm 模式，闸门会向本机通路
    //    发 select；应答"允许一次"让它通过
    let select: { id: string } | undefined;
    await waitUntil(
      () => {
        select = messages3.find((message) => (message as { type: string }).type === "ui.request") as
          | { id: string }
          | undefined;
        return select !== undefined;
      },
      20_000,
      "闸门向本机通路发起 select",
    );
    const confirmed = select as { id: string };
    await later.receive({
      type: "ui.response",
      id: confirmed.id,
      value: "允许一次",
      responderId: "later",
    });

    await waitUntil(
      () => {
        const target = dataDir as string;
        return require("node:fs").readFileSync(join(target, "u.txt"), "utf8") === "v1";
      },
      20_000,
      "agent 重试写文件",
    );

    // 6. 解决记录落盘
    const afterEntries = await repo?.entries();
    expect(
      afterEntries?.some((entry) => entry.type === "custom" && entry.customType === "ui.resolved"),
      "解决记录应落盘",
    ).toBe(true);
    void messages2;
    void messages3;
  }, 30_000);
});
