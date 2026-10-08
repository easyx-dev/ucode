/**
 * 每步耗时归因单测：三段耗时、token 与上下文、等用户时间、落条目的形状。
 *
 * 用注入的假时钟走事件序列，不依赖真实模型。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AgentSessionEvent, SessionManager } from "@earendil-works/pi-coding-agent";

import { STEP_CUSTOM_TYPE, type StepRecord, StepTelemetry } from "../index";

const clock = { now: 0 };

const setup = (): { manager: SessionManager; telemetry: StepTelemetry } => {
  clock.now = 0;
  return {
    manager: SessionManager.inMemory("/tmp/telemetry-project"),
    telemetry: new StepTelemetry(() => clock.now),
  };
};

const stepRecordOf = (manager: SessionManager): StepRecord | undefined => {
  for (const entry of manager.getBranch()) {
    if (entry.type === "custom" && entry.customType === STEP_CUSTOM_TYPE) {
      return entry.data as StepRecord;
    }
  }
  return undefined;
};

const event = (value: Record<string, unknown>): AgentSessionEvent =>
  value as unknown as AgentSessionEvent;

describe("每步耗时归因", () => {
  it("把一次往返拆成首 token / 解码 / 工具三段，并带上 token 与上下文", () => {
    const { manager, telemetry } = setup();
    telemetry.attach("s1", 400_000);

    telemetry.observe("s1", event({ type: "turn_start" }), manager);
    clock.now = 200;
    telemetry.observe(
      "s1",
      event({ type: "message_update", assistantMessageEvent: { type: "start" } }),
      manager,
    );
    clock.now = 1_200;
    telemetry.observe(
      "s1",
      event({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 100, cacheRead: 50_000, output: 200, reasoning: 150 },
          content: [
            { type: "text", text: "看完了" },
            { type: "toolCall", id: "c1", name: "read" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
          ],
        },
      }),
      manager,
    );
    clock.now = 1_800;
    telemetry.observe("s1", event({ type: "turn_end", message: {}, toolResults: [] }), manager);

    const record = stepRecordOf(manager);
    assert.ok(record, "应写入一条每步耗时记录");
    assert.equal(record.turn, 1);
    assert.equal(record.ttftMs, 200);
    assert.equal(record.streamMs, 1_000);
    assert.equal(record.toolMs, 600);
    assert.equal(record.toolCalls, 1);
    assert.equal(record.contextTokens, 50_100);
    assert.equal(record.contextBudget, 400_000);
    assert.deepEqual(record.attachments, { images: 1, bytes: 4 });
  });

  it("等用户的时间单独累计，不混进工具耗时", () => {
    const { manager, telemetry } = setup();
    telemetry.attach("s1", null);
    telemetry.observe("s1", event({ type: "turn_start" }), manager);
    clock.now = 100;
    telemetry.observe(
      "s1",
      event({ type: "message_update", assistantMessageEvent: { type: "start" } }),
      manager,
    );
    clock.now = 300;
    telemetry.observe(
      "s1",
      event({ type: "message_end", message: { role: "assistant", usage: {} } }),
      manager,
    );
    // 工具挂起等用户答复：这段从系统耗时里摘出来
    telemetry.beginUserWait("s1", 500);
    clock.now = 900;
    telemetry.endUserWait("s1", 900);
    clock.now = 1_000;
    telemetry.observe("s1", event({ type: "turn_end" }), manager);

    const record = stepRecordOf(manager);
    assert.ok(record);
    assert.equal(record.userWaitMs, 400);
    assert.equal(record.toolMs, 700);
  });

  it("没有 turn_start 的会话不落记录，避免写出半截数据", () => {
    const { manager, telemetry } = setup();
    telemetry.attach("s1", null);
    telemetry.observe("s1", event({ type: "turn_end" }), manager);
    assert.equal(stepRecordOf(manager), undefined);
  });

  it("多条往返按 turn 递增累计", () => {
    const { manager, telemetry } = setup();
    telemetry.attach("s1", null);
    for (const expected of [1, 2]) {
      telemetry.observe("s1", event({ type: "turn_start" }), manager);
      clock.now += 10;
      telemetry.observe(
        "s1",
        event({ type: "message_update", assistantMessageEvent: { type: "start" } }),
        manager,
      );
      clock.now += 10;
      telemetry.observe(
        "s1",
        event({ type: "message_end", message: { role: "assistant", usage: {} } }),
        manager,
      );
      clock.now += 10;
      telemetry.observe("s1", event({ type: "turn_end" }), manager);
      const records = manager
        .getBranch()
        .flatMap((entry) =>
          entry.type === "custom" && entry.customType === STEP_CUSTOM_TYPE
            ? [(entry.data as StepRecord).turn]
            : [],
        );
      assert.equal(records.at(-1), expected);
    }
  });
});
