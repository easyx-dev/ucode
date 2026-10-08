/**
 * 子智能体并发占位单测：占位上限、排队交接、队列上限与中止。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SubagentSlots } from "../slots";

const slots = (limit = 2, queueMax = 1): SubagentSlots => new SubagentSlots(limit, queueMax, 1_000);

const tick = (): Promise<void> => new Promise((done) => setImmediate(done));

describe("子智能体并发占位", () => {
  it("未到上限时直接拿到占位", async () => {
    const pool = slots(2, 1);
    const first = await pool.acquire();
    const second = await pool.acquire();
    assert.equal(pool.running, 2);
    first.release();
    assert.equal(pool.running, 1);
    second.release();
    assert.equal(pool.running, 0);
  });

  it("满了就排队，有人释放时把占位交接给排队者", async () => {
    const pool = slots(1, 1);
    const held = await pool.acquire();
    let queued: boolean = false;
    const waiting = pool.acquire().then((slot) => {
      queued = true;
      return slot;
    });
    await tick();
    assert.equal(queued, false, "没有空位时应处于排队中");
    assert.equal(pool.running, 1);

    held.release();
    const handed = await waiting;
    assert.equal(queued, true);
    assert.equal(pool.running, 1, "交接不改变占位数量");
    handed.release();
    assert.equal(pool.running, 0);
  });

  it("队列也满时明确报错，而不是无限排队", async () => {
    const pool = slots(1, 1);
    const held = await pool.acquire();
    const waiting = pool.acquire();
    await assert.rejects(pool.acquire(), /排队也满了/);
    held.release();
    (await waiting).release();
  });

  it("排队期间被中止即退出队列，不占用后续名额", async () => {
    const pool = slots(1, 1);
    const held = await pool.acquire();
    const controller = new AbortController();
    const waiting = pool.acquire(controller.signal);
    await tick();
    controller.abort();
    await assert.rejects(waiting, /已中止/);

    held.release();
    const next = await pool.acquire();
    assert.equal(pool.running, 1);
    next.release();
  });

  it("release 幂等：重复释放不会把占位算成负数", async () => {
    const pool = slots(2, 1);
    const slot = await pool.acquire();
    slot.release();
    slot.release();
    assert.equal(pool.running, 0);
  });
});
