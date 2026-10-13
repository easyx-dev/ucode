/** 渲染节点投影单测：present_plan 是内部信号，调用与结果都不成段，且不影响计划决策的判定 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPACTION_RECORD_CUSTOM_TYPE,
  type CompactionRecord,
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_RECORD_CUSTOM_TYPE,
  type GoalRecord,
  PLAN_APPROVED_CUSTOM_TYPE,
} from "@ucode/contracts";
import type { ChatItem, MessageBlock } from "../../../../types";
import { buildChatRows } from "../chat-rows";
import { lastTurnPresentedPlan, PRESENT_PLAN_TOOL } from "../plan";

const AT = "2026-01-01T10:00:00.000Z";

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const call = (id: string, name: string): MessageBlock => ({ type: "toolCall", id, name, args: {} });

const userItem = (id: string, value: string): ChatItem => ({
  id,
  role: "user",
  blocks: [text(value)],
  createdAt: AT,
});

const assistantItem = (id: string, blocks: MessageBlock[]): ChatItem => ({
  id,
  role: "assistant",
  blocks,
  createdAt: AT,
});

const toolItem = (id: string, toolCallId: string, name: string): ChatItem => ({
  id,
  role: "tool",
  blocks: [text("已提交")],
  toolCallId,
  toolName: name,
  createdAt: AT,
});

/** 压缩条目投影出来的摘要消息（`role: "summary"`，正文是 pi 给的结构化摘要） */
const summaryItem = (id: string, summary: string): ChatItem => ({
  id,
  role: "summary",
  blocks: [text(summary)],
  createdAt: AT,
});

/** 压缩记录条目（`COMPACTION_RECORD_CUSTOM_TYPE`），事件 / 跳过 / 失败都走它 */
const compactionRecordItem = (id: string, record: Omit<CompactionRecord, "at">): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: COMPACTION_RECORD_CUSTOM_TYPE,
  compactionRecord: { ...record, at: AT },
  createdAt: AT,
});

const kindsOf = (items: ChatItem[]): string[] => buildChatRows(items).map((row) => row.kind);

const legsOf = (items: ChatItem[]): string[] => {
  const row = buildChatRows(items).find((item) => item.kind === "activity");
  if (row?.kind !== "activity") return [];
  return row.node.legs.map((leg) => (leg.kind === "thought" ? "thought" : leg.entry.name));
};

describe("present_plan 不进消息区", () => {
  it("调用与它的结果都不成段，正文照常显示", () => {
    const items = [
      userItem("u1", "看下这个方案"),
      assistantItem("a1", [text("方案如下……"), call("c1", PRESENT_PLAN_TOOL)]),
      toolItem("t1", "c1", PRESENT_PLAN_TOOL),
    ];

    assert.deepEqual(kindsOf(items), ["content", "content"]);
  });

  it("调用被裁剪出上下文时，孤儿的 present_plan 结果也不成段", () => {
    assert.deepEqual(kindsOf([toolItem("t1", "c1", PRESENT_PLAN_TOOL)]), []);
  });

  it("整条 assistant 只有 present_plan 调用时不成行", () => {
    const items = [userItem("u1", "问一句"), assistantItem("a1", [call("c1", PRESENT_PLAN_TOOL)])];

    assert.deepEqual(kindsOf(items), ["content"]);
  });

  it("聚合行与折叠统计都看不到它", () => {
    const items = [
      userItem("u1", "查一下"),
      assistantItem("a1", [
        { type: "thinking", text: "先看文件" },
        call("c1", "read"),
        call("c2", PRESENT_PLAN_TOOL),
      ]),
      toolItem("t1", "c1", "read"),
      toolItem("t2", "c2", PRESENT_PLAN_TOOL),
    ];

    assert.deepEqual(legsOf(items), ["thought", "read"]);
  });

  it("plan 模式的决策判定仍能扫到调用（扫的是条目，不是渲染节点）", () => {
    const items = [
      userItem("u1", "看下这个方案"),
      assistantItem("a1", [text("方案如下……"), call("c1", PRESENT_PLAN_TOOL)]),
      toolItem("t1", "c1", PRESENT_PLAN_TOOL),
    ];

    assert.equal(lastTurnPresentedPlan(items), true);
  });
});

/** 合成输入条目（`custom_message`，目标注入与计划批准都走它） */
const injectedItem = (
  id: string,
  customType: string,
  value: string,
  goalPrompt?: ChatItem["goalPrompt"],
): ChatItem => ({
  id,
  role: "custom",
  blocks: [text(value)],
  customType,
  ...(goalPrompt ? { goalPrompt } : {}),
  createdAt: AT,
});

/** 目标记录条目（`GOAL_RECORD_CUSTOM_TYPE`） */
const goalRecordItem = (id: string, record: GoalRecord): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: GOAL_RECORD_CUSTOM_TYPE,
  goalRecord: record,
  createdAt: AT,
});

describe("目标完成与合成输入", () => {
  it("目标注入与结论并成一条逐轮行，计划批准仍是合成输入行", () => {
    const items = [
      userItem("u1", "继续"),
      assistantItem("a1", [text("好的")]),
      injectedItem("i1", GOAL_PROMPT_CUSTOM_TYPE, "目标：把 TODO 做完", {
        kind: "continuation",
        turn: 3,
      }),
      goalRecordItem("g1", {
        event: "verdict",
        turns: 3,
        verdict: { achieved: false, reason: "还差测试", nextStep: "跑测试" },
        at: AT,
      }),
      injectedItem("i2", PLAN_APPROVED_CUSTOM_TYPE, "计划已批准，请开始执行。"),
    ];
    const rows = buildChatRows(items);

    assert.deepEqual(
      rows.map((row) => row.kind),
      ["content", "content", "goalTurn", "injected"],
    );
    const turn = rows[2];
    if (turn?.kind !== "goalTurn") throw new Error("应是目标逐轮行");
    assert.equal(turn.node.turn.kind, "continuation");
    assert.equal(turn.node.turn.turn, 3);
    assert.equal(turn.node.turn.outcome?.reason, "还差测试");
  });

  it("逐轮行处在轮末也不抢走页脚，页脚仍落在真正回答的那一行", () => {
    const items = [
      userItem("u1", "问一句"),
      assistantItem("a1", [text("答一句")]),
      injectedItem("i1", GOAL_PROMPT_CUSTOM_TYPE, "目标：继续", { kind: "continuation", turn: 1 }),
      goalRecordItem("g1", { event: "verdict", turns: 1, at: AT }),
    ];
    const rows = buildChatRows(items);

    assert.deepEqual(
      rows.map((row) => row.kind),
      ["content", "content", "goalTurn"],
    );
    const owner = rows.find((row) => "footer" in row && row.footer) as
      | { footer?: { item: ChatItem } }
      | undefined;
    assert.equal(owner?.footer?.item.role, "assistant");
  });

  it("开轮条目被压缩掉时，完成仍单独成线（兜底）", () => {
    const items = [
      userItem("u1", "跑吧"),
      assistantItem("a1", [text("做完了")]),
      goalRecordItem("g1", {
        event: "completed",
        status: "completed",
        turns: 2,
        verdict: { achieved: true, reason: "测试全绿", nextStep: "" },
        at: AT,
      }),
    ];
    const rows = buildChatRows(items);

    assert.deepEqual(
      rows.map((row) => row.kind),
      ["content", "content", "goal"],
    );
  });

  it("目标完成出一条 goal 行，页脚仍归真正回答的那一行", () => {
    const completed: GoalRecord = {
      event: "completed",
      status: "completed",
      turns: 2,
      verdict: { achieved: true, reason: "测试全绿", nextStep: "" },
      at: AT,
    };
    const items = [
      userItem("u1", "跑吧"),
      assistantItem("a1", [text("做完了")]),
      goalRecordItem("g1", completed),
      // 每轮的校验结论只留在文件里，不进消息区
      goalRecordItem("g2", { event: "verdict", turns: 1, at: AT }),
    ];
    const rows = buildChatRows(items);

    assert.deepEqual(
      rows.map((row) => row.kind),
      ["content", "content", "goal"],
    );
    const owner = rows.find((row) => "footer" in row && row.footer) as
      | { footer?: { item: ChatItem } }
      | undefined;
    assert.equal(owner?.footer?.item.role, "assistant");
  });
});

describe("压缩摘要独立成段", () => {
  it("压缩条目成 compaction 行，当普通内容行会让人误以为是一轮回答", () => {
    const items = [
      summaryItem("c1", "## Goal\n继续实现"),
      userItem("u1", "继续"),
      assistantItem("a1", [text("好的")]),
    ];

    assert.deepEqual(kindsOf(items), ["compaction", "content", "content"]);
  });

  it("压缩行处在轮末也不抢走页脚，页脚仍落在真正回答的那一行", () => {
    const items = [
      userItem("u1", "问一句"),
      assistantItem("a1", [text("答一句")]),
      summaryItem("c1", "## Goal\n继续"),
    ];
    const rows = buildChatRows(items);
    // 压缩行与工作中的行都没有页脚字段，故按「有则取，无则空」读
    const ownerOf = (row: (typeof rows)[number] | undefined): string | undefined =>
      row && "footer" in row ? row.footer?.item.role : undefined;

    assert.equal(ownerOf(rows[0]), undefined);
    assert.equal(ownerOf(rows[1]), "assistant", "页脚应落在 assistant 内容行上");
    assert.equal(rows[2]?.kind, "compaction");
  });

  it("有压缩记录时并成一行，位置取记录（时间线上真正压缩的那一点）", () => {
    const items = [
      summaryItem("c1", "## Goal\n继续"),
      userItem("u1", "继续"),
      assistantItem("a1", [text("好的")]),
      compactionRecordItem("r1", { reason: "threshold", outcome: "done", tokensBefore: 12_300 }),
    ];
    const rows = buildChatRows(items);
    const compaction = rows.filter((row) => row.kind === "compaction");

    assert.equal(compaction.length, 1, "摘要与记录只应该出一行");
    assert.equal(compaction[0]?.key, "r1", "行的位置跟着记录走");
    if (compaction[0]?.kind !== "compaction") throw new Error("应是压缩行");
    assert.equal(compaction[0].node.summary, "## Goal\n继续");
    assert.equal(compaction[0].node.record?.reason, "threshold");
  });

  it("只有跳过 / 失败的记录时也出一行，带出原因且没有摘要", () => {
    const items = [
      userItem("u1", "继续"),
      assistantItem("a1", [text("好的")]),
      compactionRecordItem("r1", { reason: "manual", outcome: "skipped", skip: "too_small" }),
    ];
    const rows = buildChatRows(items);
    const compaction = rows.filter((row) => row.kind === "compaction");

    assert.equal(compaction.length, 1);
    if (compaction[0]?.kind !== "compaction") throw new Error("应是压缩行");
    assert.equal(compaction[0].node.summary, "");
    assert.equal(compaction[0].node.record?.outcome, "skipped");
  });
});
