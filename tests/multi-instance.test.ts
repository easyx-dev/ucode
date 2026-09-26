import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Core, createCore } from "@ucode/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeProvider,
  startFakeProvider,
} from "../packages/core/src/testing/fake-provider.ts";

/**
 * 多实例共享一个数据层（spec §3.7 / ADR-008 的端到端验证）。
 *
 * 两个核心层实例指向同一个目录：
 * - 先到者通过 owner 竞争拿到写权（协议 D 的 owner 语义）；
 * - 后到者是**只读挂载**：不建 agent 运行时，改为**跟随数据层文件的追加流**——
 *   这就是"数据层文件兼作实例间事件总线"：没有服务发现、没有连接、没有认证，照样实时。
 * - owner 侧发生格式迁移（文件被原地重写）时，跟随者必须收到显式的重同步信号（V-5）。
 */

let cores: Core[] = [];
let provider: FakeProvider | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  for (const core of cores) await core.close().catch(() => undefined);
  cores = [];
  await provider?.close();
  provider = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function makeCore(name: string): Promise<Core> {
  if (dataDir === undefined) {
    dataDir = await mkdtemp(join(tmpdir(), "multi-instance-"));
    provider = await startFakeProvider({ defaultReply: { text: "来自 owner 的回答。" } });
    await provider.writeModelsJson(dataDir);
  }
  const core = await createCore({ dataDir, cwd: dataDir, coreId: `core-${name}` });
  cores.push(core);
  return core;
}

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
    }, 25);
  });
}

describe("多实例共享数据层", () => {
  it("owner 写入，跟随者实时看到；跟随者写入被拒；迁移触发重同步", async () => {
    const owner = await makeCore("owner");
    const follower = await makeCore("follower");

    // owner 侧建会话并跑一轮
    const ownerSend: unknown[] = [];
    const ownerHandle = owner.attachConnection({
      binding: "test",
      trustLevel: "implicit",
      send: (message) => ownerSend.push(message),
    });
    await ownerHandle.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "owner-client-2",
      clientKind: "test",
      binding: "test",
      capabilities: ["sessions.read", "sessions.write", "prompt.run"],
    });
    await ownerHandle.receive({
      type: "command",
      id: "c1",
      command: "session.create",
      sessionId: null,
      args: { cwd: dataDir },
    });
    const created = ownerSend.findLast(
      (message) => (message as { type: string }).type === "response",
    ) as { data?: { sessionId: string } };
    const sessionId = created.data?.sessionId as string;
    expect(sessionId).toBeTruthy();
    await ownerHandle.receive({
      type: "command",
      id: "c2",
      command: "session.attach",
      sessionId,
      args: {},
    });
    await ownerHandle.receive({
      type: "command",
      id: "c3",
      command: "prompt",
      sessionId,
      args: { text: "第一句" },
    });
    await waitUntil(
      () => ownerSend.some((message) => (message as { type: string }).type === "agent_settled"),
      25_000,
      "owner 第一轮结束",
    );

    // 跟随者挂载：拿到的是只读挂载 + 全量重放
    const followerMessages: unknown[] = [];
    const followerHandle = follower.attachConnection({
      binding: "test",
      trustLevel: "implicit",
      send: (message) => followerMessages.push(message),
    });
    await followerHandle.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "follower-client",
      clientKind: "test",
      binding: "test",
      capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
    });
    await followerHandle.receive({
      type: "command",
      id: "f1",
      command: "session.attach",
      sessionId,
      args: {},
    });
    const attachResponse = followerMessages.findLast(
      (message) =>
        (message as { type: string; id?: string }).type === "response" &&
        (message as { id?: string }).id === "f1",
    ) as { success: boolean; data?: { readOnly: boolean } };
    expect(attachResponse.success).toBe(true);
    expect(attachResponse.data?.readOnly).toBe(true);
    const replayed = followerMessages.filter(
      (message) => (message as { type: string }).type === "entry_appended",
    );
    expect(replayed.length, "挂载时应收到全量重放").toBeGreaterThan(0);

    // 跟随者写入被拒（owner 语义）
    await followerHandle.receive({
      type: "command",
      id: "f2",
      command: "prompt",
      sessionId,
      args: { text: "跟随者想说话" },
    });
    const denied = followerMessages.findLast(
      (message) =>
        (message as { type: string; id?: string }).type === "response" &&
        (message as { id?: string }).id === "f2",
    ) as { success: boolean; error?: { code: string } };
    expect(denied.success).toBe(false);
    expect(denied.error?.code).toBe("session_not_owned");

    // owner 再跑一轮：跟随者必须**实时**收到新增记录（没有实例间通道，靠数据层文件本身）
    const before = replayed.length;
    await ownerHandle.receive({
      type: "command",
      id: "c4",
      command: "prompt",
      sessionId,
      args: { text: "第二句" },
    });
    await waitUntil(
      () => {
        const seen = followerMessages.filter(
          (message) => (message as { type: string }).type === "entry_appended",
        );
        return seen.length > before;
      },
      20_000,
      "跟随者收到 owner 的新增记录",
    );

    // 迁移：文件被原地重写（inode 不变）→ 跟随者收到显式重同步信号
    const sessionFile = (await owner.store.listSessions()).find(
      (session) => session.id === sessionId,
    )?.file as string;
    const content = await readFile(sessionFile, "utf8");
    const header = content.split("\n")[0] as string;
    await writeFile(
      sessionFile,
      `${header}\n${JSON.stringify({
        type: "custom",
        id: "migrated1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "migrated",
      })}\n`,
      "utf8",
    );
    await waitUntil(
      () =>
        followerMessages.some(
          (message) => (message as { type: string }).type === "resync_required",
        ),
      20_000,
      "迁移后的重同步信号",
    );
    const resync = followerMessages.findLast(
      (message) => (message as { type: string }).type === "resync_required",
    ) as { reason: string; cursor: number };
    expect(resync.reason).toBe("migration");
    expect(resync.cursor).toBe(1);
  }, 90_000);
});
