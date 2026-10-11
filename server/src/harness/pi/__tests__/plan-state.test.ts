/** 计划待决策判定：本轮（最后一条用户消息之后）出现过 present_plan 且尚未决策 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { PLAN_IGNORED_CUSTOM_TYPE } from "@ucode/contracts";
import { isPlanAwaitingDecision } from "../plan-state";

const userEntry = (): SessionEntry =>
  ({
    type: "message",
    id: "u1",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user" },
  }) as unknown as SessionEntry;

const assistantTextEntry = (): SessionEntry =>
  ({
    type: "message",
    id: "a1",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "计划如下" }] },
  }) as unknown as SessionEntry;

/** present_plan 的工具结果条目 */
const planResultEntry = (): SessionEntry =>
  ({
    type: "message",
    id: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "toolResult", toolName: "present_plan", content: [] },
  }) as unknown as SessionEntry;

/** 助手消息里的 present_plan 调用块（工具结果还没落盘的中间态） */
const planCallEntry = (): SessionEntry =>
  ({
    type: "message",
    id: "a2",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "assistant", content: [{ type: "toolCall", name: "present_plan" }] },
  }) as unknown as SessionEntry;

const otherToolEntry = (): SessionEntry =>
  ({
    type: "message",
    id: "t2",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "toolResult", toolName: "read", content: [] },
  }) as unknown as SessionEntry;

const ignoredEntry = (): SessionEntry =>
  ({
    type: "custom",
    id: "c1",
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: PLAN_IGNORED_CUSTOM_TYPE,
    data: {},
  }) as unknown as SessionEntry;

describe("isPlanAwaitingDecision", () => {
  it("本轮以 present_plan 的工具结果收尾时等决策", () => {
    assert.equal(
      isPlanAwaitingDecision([userEntry(), assistantTextEntry(), planResultEntry()]),
      true,
    );
  });

  it("调用块已出现、结果还没落盘同样算等决策", () => {
    assert.equal(isPlanAwaitingDecision([userEntry(), planCallEntry()]), true);
  });

  it("本轮没有 present_plan 时不等决策", () => {
    assert.equal(
      isPlanAwaitingDecision([userEntry(), assistantTextEntry(), otherToolEntry()]),
      false,
    );
  });

  it("用户已经反馈（新的一轮开始了）就不再等决策", () => {
    assert.equal(isPlanAwaitingDecision([userEntry(), planResultEntry(), userEntry()]), false);
  });

  it("计划被忽略后不再等决策", () => {
    assert.equal(isPlanAwaitingDecision([userEntry(), planResultEntry(), ignoredEntry()]), false);
  });

  it("拿不到任何条目时不等决策", () => {
    assert.equal(isPlanAwaitingDecision([]), false);
  });
});
