/** 渲染节点投影单测：present_plan 是内部信号，调用与结果都不成段，且不影响计划决策的判定 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatRows } from "../chat-rows";
import { lastTurnPresentedPlan, PRESENT_PLAN_TOOL } from "../plan";
import type { ChatItem, MessageBlock } from "../types";

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
});
