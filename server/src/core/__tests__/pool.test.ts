/** SessionPool 直接单测：锁的串行语义、运行态口径与子智能体清单维护（其余路径依赖真实 pi 会话） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionRepository } from "../../db/session-repository";
import type { GoalService } from "../../harness/goal";
import type { MemoryService } from "../../harness/memory";
import type { SessionAllowStore } from "../../harness/permissions";
import type { UsageService } from "../../harness/usage";
import { SessionEventBus } from "../event-bus";
import { InteractionBroker } from "../interactions";
import { SessionPool } from "../pool";
import type { PiRuntime } from "../runtime";

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
