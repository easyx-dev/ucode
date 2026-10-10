/** 目标逐轮配对单测：注入与它那一轮的结论按条目顺序配对，配上的结论不再单独成行 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_RECORD_CUSTOM_TYPE,
  type GoalPromptKind,
  type GoalRecord,
} from "@ucode/contracts";

import { buildGoalTurns } from "../goal-turns";
import type { ChatItem, MessageBlock } from "../types";

const AT = "2026-01-01T10:00:00.000Z";

const text = (value: string): MessageBlock => ({ type: "text", text: value });

/** 目标注入条目（`custom_message`） */
const promptItem = (id: string, kind: GoalPromptKind, value: string, turn?: number): ChatItem => ({
  id,
  role: "custom",
  blocks: [text(value)],
  customType: GOAL_PROMPT_CUSTOM_TYPE,
  goalPrompt: { kind, ...(turn !== undefined ? { turn } : {}) },
  createdAt: AT,
});

/** 目标记录条目 */
const recordItem = (id: string, record: GoalRecord): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: GOAL_RECORD_CUSTOM_TYPE,
  goalRecord: record,
  createdAt: AT,
});

describe("buildGoalTurns", () => {
  it("注入开一轮，其后的校验结论归到它并进 consumed", () => {
    const items = [
      promptItem("p1", "kickoff", "目标：把 TODO 做完"),
      recordItem("r1", {
        event: "verdict",
        turns: 1,
        verdict: { achieved: false, reason: "还差测试", nextStep: "跑测试" },
        turnTokens: 120,
        turnToolCalls: 2,
        turnMs: 1500,
        at: AT,
      }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.key, "p1");
    assert.equal(turns[0]?.kind, "kickoff");
    assert.equal(turns[0]?.text, "目标：把 TODO 做完");
    assert.equal(turns[0]?.outcome?.event, "verdict");
    assert.equal(turns[0]?.outcome?.reason, "还差测试");
    assert.equal(turns[0]?.outcome?.turnTokens, 120);
    assert.equal(turns[0]?.outcome?.turnToolCalls, 2);
    assert.equal(turns[0]?.outcome?.turnMs, 1500);
    assert.deepEqual([...consumed], ["r1"]);
  });

  it("一次落定连落两条时合并：结论留在 verdict，暂停原因来自 pause", () => {
    const items = [
      promptItem("p1", "continuation", "目标：继续", 1),
      recordItem("r1", {
        event: "verdict",
        turns: 1,
        verdict: { achieved: false, reason: "还差测试", nextStep: "跑测试" },
        turnTokens: 300,
        at: AT,
      }),
      recordItem("r2", { event: "pause", cause: "budget", turns: 1, at: AT }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.outcome?.event, "pause");
    assert.equal(turns[0]?.outcome?.cause, "budget");
    assert.equal(turns[0]?.outcome?.reason, "还差测试", "pause 没带结论，不能把结论盖掉");
    assert.equal(turns[0]?.outcome?.nextStep, "跑测试");
    assert.equal(turns[0]?.outcome?.turnTokens, 300);
    assert.deepEqual([...consumed], ["r1", "r2"]);
  });

  it("按条目顺序配对，不按轮号（暂停后恢复会沿用同一轮号）", () => {
    const items = [
      promptItem("p1", "kickoff", "目标：先跑一轮"),
      recordItem("r1", { event: "pause", cause: "user", turns: 0, at: AT }),
      promptItem("p2", "resume", "目标：恢复"),
      recordItem("r2", {
        event: "verdict",
        turns: 1,
        verdict: { achieved: false, reason: "继续", nextStep: "" },
        at: AT,
      }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.equal(turns.length, 2, "两轮同处一条目标里，但按顺序是两轮");
    assert.equal(turns[0]?.key, "p1");
    assert.equal(turns[0]?.outcome?.event, "pause");
    assert.equal(turns[0]?.outcome?.cause, "user");
    assert.equal(turns[1]?.key, "p2");
    assert.equal(turns[1]?.outcome?.event, "verdict");
    assert.deepEqual([...consumed], ["r1", "r2"]);
  });

  it("完成归到它那一轮，并记下事件", () => {
    const items = [
      promptItem("p1", "continuation", "目标：继续", 2),
      recordItem("r1", {
        event: "completed",
        status: "completed",
        turns: 2,
        verdict: { achieved: true, reason: "测试全绿", nextStep: "" },
        at: AT,
      }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.equal(turns[0]?.outcome?.event, "completed");
    assert.equal(turns[0]?.outcome?.achieved, true);
    assert.equal(turns[0]?.outcome?.reason, "测试全绿");
    assert.deepEqual([...consumed], ["r1"]);
  });

  it("开轮条目被压缩掉时，记录既不归轮也不被消费", () => {
    const items = [
      recordItem("r1", {
        event: "verdict",
        turns: 4,
        verdict: { achieved: false, reason: "旧", nextStep: "" },
        at: AT,
      }),
      recordItem("r2", { event: "completed", status: "completed", turns: 5, at: AT }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.deepEqual(turns, []);
    assert.equal(consumed.size, 0);
  });

  it("不归轮的记录（set / clear / budget）不消费", () => {
    const items = [
      promptItem("p1", "kickoff", "目标：做点事"),
      recordItem("r1", { event: "budget", turns: 0, at: AT }),
      recordItem("r2", { event: "verdict", turns: 0, at: AT }),
    ];
    const { turns, consumed } = buildGoalTurns(items);

    assert.equal(turns.length, 1);
    assert.deepEqual([...consumed], ["r2"]);
  });
});
