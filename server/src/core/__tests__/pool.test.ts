/** SessionPool 直接单测：锁的串行语义、运行态口径与子智能体清单维护（其余路径依赖真实 pi 会话） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionRepository } from "../../db/session-repository";
import type { GoalService } from "../../harness/features/goal";
import type { MemoryService } from "../../harness/features/memory";
import type { UsageService } from "../../harness/features/usage";
import type { PiRuntime } from "../../harness/pi/runtime";
import type { SessionAllowStore } from "../../harness/setup/permissions";
import { SessionEventBus } from "../event-bus";
import { InteractionBroker } from "../interactions";
import { SessionPool } from "../pool";

/** 构造只存引用的池：除仓储的 find 外，其余依赖在以下用例里都不被触达 */
const createPool = (): { pool: SessionPool; events: SessionEventBus } => {
  const events = new SessionEventBus();
  const pool = new SessionPool(
    {} as unknown as PiRuntime,
    { find: () => undefined } as unknown as SessionRepository,
    events,
    () => ({ provider: "brave", apiKey: "", baseUrl: "" }),
    { allow: {} as unknown as SessionAllowStore, interactions: new InteractionBroker(events) },
    {} as unknown as MemoryService,
    {} as unknown as GoalService,
    {} as unknown as UsageService,
  );
  return { pool, events };
};

describe("SessionPool.withLock", () => {
  it("同一会话串行：前一个任务未完成时不开始下一个", async () => {
    const { pool } = createPool();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = pool.withLock("s1", async () => {
      order.push("a1");
      await gate;
      order.push("a2");
    });
    const second = pool.withLock("s1", async () => {
      order.push("b");
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(order, ["a1"]);

    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["a1", "a2", "b"]);
  });

  it("不同会话互不阻塞", async () => {
    const { pool } = createPool();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const blocked = pool.withLock("s1", async () => {
      await gate;
    });
    let other = false;
    const free = pool.withLock("s2", async () => {
      other = true;
    });

    await free;
    assert.equal(other, true, "s1 阻塞时 s2 仍应推进");

    release();
    await blocked;
  });
});

describe("SessionPool.statusOf", () => {
  it("占位期间为 running，收尾后回到 idle", () => {
    const { pool } = createPool();

    assert.equal(pool.statusOf("s1"), "idle");
    assert.equal(pool.beginRun("s1"), true);
    assert.equal(pool.statusOf("s1"), "running");

    pool.endRun("s1");
    assert.equal(pool.statusOf("s1"), "idle");
  });

  it("已有 run 占位时不再开启新一轮，收尾后可再次开启", () => {
    const { pool } = createPool();

    assert.equal(pool.beginRun("s1"), true);
    assert.equal(pool.beginRun("s1"), false);

    pool.endRun("s1");
    assert.equal(pool.beginRun("s1"), true);
    pool.endRun("s1");
  });
});

describe("SessionPool 子智能体清单", () => {
  it("subagent_start 记入、subagent_end 移除", () => {
    const { pool, events } = createPool();

    events.emitFrame("s1", "subagent_start", {
      toolCallId: "t1",
      sessionId: "sub-1",
      description: "侦察",
    });
    events.emitFrame("s1", "subagent_start", {
      toolCallId: "t2",
      sessionId: "sub-2",
      description: "实现",
    });
    assert.deepEqual(
      pool.runningSubagentsOf("s1").map((item) => item.toolCallId),
      ["t1", "t2"],
    );

    events.emitFrame("s1", "subagent_end", { toolCallId: "t1", sessionId: "sub-1" });
    assert.deepEqual(
      pool.runningSubagentsOf("s1").map((item) => item.toolCallId),
      ["t2"],
    );
  });

  it("载荷缺少 toolCallId 时忽略", () => {
    const { pool, events } = createPool();

    events.emitFrame("s1", "subagent_start", { sessionId: "sub-1" });
    assert.deepEqual(pool.runningSubagentsOf("s1"), []);
  });
});

describe("SessionPool.recycleForPluginChange", () => {
  /** 造一个只带交互中转的池：这里只验证回收计划，其它依赖都不被触达 */
  const createPoolWithInteractions = (pending: (sessionId: string) => boolean) => {
    const events = new SessionEventBus();
    const interactions = new InteractionBroker(events);
    interactions.list = (sessionId) =>
      pending(sessionId)
        ? ([{ kind: "question" }] as unknown as ReturnType<InteractionBroker["list"]>)
        : [];
    const pool = new SessionPool(
      {} as unknown as PiRuntime,
      { find: () => undefined } as unknown as SessionRepository,
      events,
      () => ({ provider: "brave", apiKey: "", baseUrl: "" }),
      { allow: {} as unknown as SessionAllowStore, interactions },
      { discardReview: () => undefined } as unknown as MemoryService,
      { forget: () => undefined } as unknown as GoalService,
      { forget: () => undefined } as unknown as UsageService,
    );
    const internals = pool as unknown as {
      entries: Map<string, { stale: boolean }>;
      generation: number;
      pluginRevision: number;
      isPlanPending: (sessionId: string) => boolean;
    };
    internals.isPlanPending = (sessionId) => sessionId === "planning";
    for (const id of ["idle", "waiting", "planning"]) internals.entries.set(id, { stale: false });
    return { pool, internals };
  };

  it("空闲会话立刻回收，有待答交互或待确认计划的只标脏", () => {
    const { pool, internals } = createPoolWithInteractions((id) => id === "waiting");

    pool.recycleForPluginChange(4);

    assert.equal(internals.entries.has("idle"), false, "空闲会话下次访问按新代次重装");
    assert.equal(internals.entries.get("waiting")?.stale, true, "等用户回答的会话不被打回");
    assert.equal(internals.entries.get("planning")?.stale, true, "待确认计划的会话不被打回");
    assert.equal(internals.pluginRevision, 4, "插件代次被记下，供装配期比对");
  });

  it("队列里还有输入时不回收：那几条只存在实例内存里", () => {
    const { pool, internals } = createPoolWithInteractions(() => false);
    internals.entries.set("queued", {
      stale: false,
      session: { pendingMessageCount: 1 },
    } as never);

    pool.recycleForPluginChange(2);

    assert.equal(internals.entries.get("queued")?.stale, true, "有排队输入的会话不被打回");
    assert.equal(
      (pool as unknown as { recycleIfStale: (id: string) => boolean }).recycleIfStale("queued"),
      false,
    );
    assert.equal(internals.entries.has("queued"), true, "实例留着，队列里的那几条才不会丢");
  });

  it("标脏后的挂起态会话在答完前一直不被回收", () => {
    const { pool, internals } = createPoolWithInteractions((id) => id === "waiting");
    pool.recycleForPluginChange(1);

    // 落定 / 清扫都会走这里：仍挂着待答交互时不能回收
    assert.equal(
      (pool as unknown as { recycleIfStale: (id: string) => boolean }).recycleIfStale("waiting"),
      false,
    );
    assert.equal(internals.entries.has("waiting"), true);
  });
});
