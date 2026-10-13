/** 步级统计：每步耗时条目的解析与聚合（每轮步数、耗时分位、两个占比、分桶） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { STEP_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { aggregateSteps, type StepPoint, stepBuckets } from "../aggregate";
import { collectSteps, stepPointOf } from "../parse";

/** 一条步级记录；只给要断言的字段，其余留默认 */
const stepEntry = (data: Record<string, unknown>): SessionEntry =>
  ({
    type: "custom",
    customType: STEP_RECORD_CUSTOM_TYPE,
    data,
  }) as unknown as SessionEntry;

const step = (startedAt: number, endedAt: number, over: Record<string, unknown> = {}) => ({
  turn: 1,
  userTurn: 1,
  startedAt,
  endedAt,
  firstEventAt: startedAt + 100,
  firstTokenAt: null,
  respondedAt: null,
  endedAt2: null,
  firstEventMs: 100,
  ttftMs: 50,
  streamMs: 200,
  toolMs: 150,
  userWaitMs: 0,
  toolCalls: 0,
  toolNames: [],
  hasText: true,
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  contextTokens: 0,
  contextBudget: null,
  thinkingLevel: "high",
  provider: "anthropic",
  model: "claude-x",
  stopReason: "stop",
  attachments: { images: 0, bytes: 0 },
  ...over,
});

const parsed = (data: Record<string, unknown>): StepPoint => {
  const point = stepPointOf(stepEntry(data));
  assert.ok(point, "这一条应当解析成功");
  return point;
};

describe("stepPointOf", () => {
  it("解析出耗时与归属，并对失败原因归类", () => {
    // startedAt 1000 → endedAt 2000：总耗时 1000
    const point = parsed(step(1_000, 2_000, { stopReason: "aborted", toolCalls: 2 }));
    assert.equal(point.totalMs, 1_000);
    assert.equal(point.failed, true);
    assert.equal(point.provider, "anthropic");
    assert.equal(point.model, "claude-x");
    assert.equal(point.thinkingLevel, "high");
    assert.equal(point.toolCalls, 2);
    assert.equal(point.at, 2_000);
  });

  it("字段缺失或类型不对的坏记录被跳过，不影响其余记录", () => {
    const entries = [
      stepEntry({ startedAt: 1_000, endedAt: 2_000 }), // 合法：其余字段缺失也算「未知」
      stepEntry({ startedAt: "1000", endedAt: 2_000 }), // startedAt 类型不对
      stepEntry({ endedAt: 2_000 }), // 缺 startedAt
      { type: "custom", customType: "other.record", data: {} } as unknown as SessionEntry,
      stepEntry({ startedAt: 3_000, endedAt: 3_500, provider: 7 }),
    ];
    const steps = collectSteps(entries);
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.at, 2_000);
    assert.equal(steps[0]?.thinkingLevel, null);
    assert.equal(steps[0]?.provider, null);
    assert.equal(steps[1]?.provider, null, "provider 类型不对时按未知处理，而不是丢掉整条");
  });
});

describe("aggregateSteps", () => {
  it("每轮步数按用户轮分组：两轮各三步 → 每轮 3 步", () => {
    const points = [
      parsed(step(0, 1_000, { userTurn: 1 })),
      parsed(step(1_000, 2_000, { userTurn: 1 })),
      parsed(step(2_000, 3_000, { userTurn: 1 })),
      parsed(step(3_000, 4_000, { userTurn: 2 })),
      parsed(step(4_000, 5_000, { userTurn: 2 })),
      parsed(step(5_000, 6_000, { userTurn: 2 })),
    ];
    const totals = aggregateSteps(points);
    assert.equal(totals.steps, 6);
    assert.equal(totals.turns, 2);
    assert.equal(totals.stepsPerTurn, 3);
    assert.equal(totals.avgStepMs, 1_000);
  });

  it("分位取最近秩：5 步 100..500 → p50 = 300、p90 = 500", () => {
    const points = [100, 200, 300, 400, 500].map((ms, index) =>
      parsed(step(index * 10_000, index * 10_000 + ms)),
    );
    const totals = aggregateSteps(points);
    assert.equal(totals.p50StepMs, 300);
    assert.equal(totals.p90StepMs, 500);
  });

  it("纯工具耗时扣掉等用户的时间，且不出现负数", () => {
    // 每步总耗时 1000：首帧（含排队）150 + 工具 600，其中一等用户 500（其余步 0）
    const points = [
      parsed(step(0, 1_000, { firstEventMs: 100, ttftMs: 50, toolMs: 850, userWaitMs: 500 })),
      parsed(step(1_000, 2_000, { firstEventMs: 100, ttftMs: 50, toolMs: 150, userWaitMs: 0 })),
      // 等待跨轮结转时的下界：toolMs 比 userWaitMs 还小，按 0 计而不是负数
      parsed(step(2_000, 3_000, { firstEventMs: 100, ttftMs: 50, toolMs: 10, userWaitMs: 900 })),
    ];
    const totals = aggregateSteps(points);
    // 纯工具耗时 = (850-500) + (150-0) + max(0, 10-900) = 500；总耗时 3000
    assert.equal(totals.toolShare, 500 / 3_000);
    // 首帧占比 = (150 × 3) / 3000
    assert.equal(totals.ttftShare, 450 / 3_000);
    assert.equal(totals.avgFirstEventMs, 100);
    assert.equal(totals.avgTtftMs, 50);
  });

  it("失败步与工具调用分别计数", () => {
    const points = [
      parsed(step(0, 1_000, { stopReason: "error", toolCalls: 1 })),
      parsed(step(1_000, 2_000, { stopReason: "stop", toolCalls: 2 })),
      parsed(step(2_000, 3_000, { stopReason: "aborted" })),
    ];
    const totals = aggregateSteps(points);
    assert.equal(totals.failedSteps, 2);
    assert.equal(totals.toolCalls, 3);
  });

  it("缓存命中率按步记录里的 token 算，没有输入时为 null", () => {
    const withTokens = aggregateSteps([
      parsed(step(0, 1_000, { inputTokens: 30, cacheReadTokens: 70 })),
    ]);
    assert.equal(withTokens.cacheHitRate, 0.7);

    assert.equal(aggregateSteps([parsed(step(0, 1_000))]).cacheHitRate, null);
    assert.equal(aggregateSteps([]).steps, 0);
    assert.equal(aggregateSteps([]).stepsPerTurn, null);
    assert.equal(aggregateSteps([]).p50StepMs, null);
  });
});

describe("stepBuckets", () => {
  it("按模型分桶，模型不明的步不进任何桶", () => {
    const points = [
      parsed(step(0, 1_000, { model: "a" })),
      parsed(step(1_000, 2_000, { model: "a" })),
      parsed(step(2_000, 3_000, { provider: null, model: null })),
    ];
    const buckets = stepBuckets(points, (point) =>
      point.model ? `${point.provider ?? ""}/${point.model}` : null,
    );
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.key, "anthropic/a");
    assert.equal(buckets[0]?.totals.steps, 2);
  });

  it("按思考档位分桶时未知归 unknown", () => {
    const points = [
      parsed(step(0, 1_000, { thinkingLevel: "high" })),
      parsed(step(1_000, 2_000, { thinkingLevel: null })),
    ];
    const keys = stepBuckets(points, (point) => point.thinkingLevel ?? "unknown")
      .map((bucket) => bucket.key)
      .sort();
    assert.deepEqual(keys, ["high", "unknown"]);
  });
});
