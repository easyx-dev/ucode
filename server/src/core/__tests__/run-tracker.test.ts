/** 一轮生成的生命周期：占位与收尾顺序（收尾顺序错会让最后一帧带着 running: true 落地） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RunTracker } from "../run-tracker";

/** 记录调用顺序的跟踪器；`runningAtEmit` 用于断言「补发摘要时占位已释放」 */
const createTracker = (): {
  tracker: RunTracker;
  calls: string[];
  runningAtEmit: () => boolean | null;
} => {
  const calls: string[] = [];
  let runningAtEmit: boolean | null = null;
  const tracker = new RunTracker({
    writeIndex: (sessionId) => calls.push(`index:${sessionId}`),
    onReleased: (sessionId) => calls.push(`released:${sessionId}`),
    emitSummary: (sessionId) => {
      runningAtEmit = tracker.isRunning(sessionId);
      calls.push(`emit:${sessionId}`);
    },
  });
  return { tracker, calls, runningAtEmit: () => runningAtEmit };
};

describe("RunTracker", () => {
  it("收尾顺序是 写索引 → 释放占位 → 补发摘要，且补发时占位已释放", () => {
    const { tracker, calls, runningAtEmit } = createTracker();

    assert.equal(tracker.begin("s1"), true);
    tracker.finish("s1");

    assert.deepEqual(calls, ["index:s1", "released:s1", "emit:s1"]);
    assert.equal(runningAtEmit(), false);
    assert.equal(tracker.isRunning("s1"), false);
  });

  it("同一会话已被占位时不再开启新一轮", () => {
    const { tracker, calls } = createTracker();

    assert.equal(tracker.begin("s1"), true);
    assert.equal(tracker.begin("s1"), false);
    tracker.finish("s1");
    assert.equal(tracker.begin("s1"), true);
  });

  it("出错标记保留到下一轮开始", () => {
    const { tracker } = createTracker();

    tracker.begin("s1");
    tracker.fail("s1");
    tracker.finish("s1");
    assert.equal(tracker.isErrored("s1"), true);

    tracker.begin("s1");
    assert.equal(tracker.isErrored("s1"), false);
  });

  it("回收会话时占位与出错标记一并清掉", () => {
    const { tracker } = createTracker();

    tracker.begin("s1");
    tracker.fail("s1");
    tracker.forget("s1");

    assert.equal(tracker.isRunning("s1"), false);
    assert.equal(tracker.isErrored("s1"), false);
  });
});
