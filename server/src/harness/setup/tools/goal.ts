/**
 * 目标模式的模型侧结算工具：模型自己判断目标达成（`goal_complete`）或受阻（`goal_blocked`）。
 *
 * 纯信号形态——工具不产出内容，本轮回复的正文才是结论；调用即结算，服务端的状态守卫兜住迟到调用。
 * 只按目标状态条件注册（同记忆工具），见 `session-config` 与 `tools/index`。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** 装配层注入的结算通道：按会话把结论交给 `GoalService` 落定 */
export type GoalToolHooks = {
  /** 目标已达成，`summary` 是判据 */
  complete: (summary: string) => void;
  /** 目标受阻，`reason` 是卡在哪里 */
  block: (reason: string) => void;
};

export const GOAL_COMPLETE_TOOL = "goal_complete";
export const GOAL_BLOCKED_TOOL = "goal_blocked";

const completeSchema = Type.Object({
  summary: Type.String({
    description: "判定目标达成的依据，写清可核对的产出（改动、测试结果、运行行为）",
  }),
});

const blockedSchema = Type.Object({
  reason: Type.String({
    description: "卡在哪里、需要什么外部条件，写清让用户能据此决策",
  }),
});

export const createGoalCompleteTool = (hooks: GoalToolHooks) =>
  defineTool({
    name: GOAL_COMPLETE_TOOL,
    label: GOAL_COMPLETE_TOOL,
    description:
      "目标已达成时调用它结算本轮。结论写在回复正文里，判据写进 summary；" +
      "调用之后本轮立即结束——不得再调用任何工具，也不得再输出任何内容。" +
      "只是完成了其中一部分、或还有未完成的待办时不要调用。",
    promptSnippet: "目标达成时结算并结束本轮",
    promptGuidelines: [
      "只有可核对的产出都完成（改动生效、测试通过、行为符合目标）时才调用。",
      "计划、待办清单与自我声明都不算达成；还有没做完的事就继续做，不要调用它。",
      "它一旦调用，本轮即结束：把结论写进回复正文，summary 里写判据。",
    ],
    parameters: completeSchema,
    async execute(_toolCallId, { summary }) {
      hooks.complete(summary.trim());
      return {
        content: [{ type: "text", text: "目标已结算，本轮到此结束。" }],
        details: { summary },
      };
    },
  });

export const createGoalBlockedTool = (hooks: GoalToolHooks) =>
  defineTool({
    name: GOAL_BLOCKED_TOOL,
    label: GOAL_BLOCKED_TOOL,
    description:
      "目标受阻、无法靠自己继续推进时调用它暂停本轮：需要用户提供信息、凭证、外部环境，或判断方向有误。" +
      "调用之后本轮立即结束——不得再调用任何工具，也不得再输出任何内容。" +
      "只是因为这一步麻烦、想换个人做时不要调用。",
    promptSnippet: "目标受阻时暂停并结束本轮",
    promptGuidelines: [
      "把卡点写清楚：试过什么、缺什么、用户做什么才能继续，写进回复正文与 reason。",
      "能自己查证或绕开的问题不要调用它；只有确实需要用户介入时才用。",
      "它一旦调用，本轮即结束：不要先做一半再调用。",
    ],
    parameters: blockedSchema,
    async execute(_toolCallId, { reason }) {
      hooks.block(reason.trim());
      return {
        content: [{ type: "text", text: "目标已暂停，本轮到此结束，等待用户处理。" }],
        details: { reason },
      };
    },
  });
