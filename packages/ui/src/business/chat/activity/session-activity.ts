/**
 * 会话活动面板的视图模型：把子智能体、目标与后台服务三块运行态拼成展示形状。
 *
 * 纯派生，不碰 store 与 DOM；悬浮摘要条与面板共用同一份结果，口径只在一处。
 */
import type { BackgroundService, GoalPauseCause, GoalStatus, GoalView } from "@ucode/contracts";
import type { ChatItem, SubagentStream, SubagentStreams } from "../../../types";
import { itemText } from "../message/chat-item";
import type { GoalTurn } from "../message/goal-turns";

/** 「最近一步」的展示长度上限：面板里只铺一行，超长正文没必要整个带进 DOM */
const LATEST_MAX_CHARS = 160;

export type ActivitySubagentStatus = "running" | "failed" | "done";

/** 面板里一条子智能体 */
export type ActivitySubagentItem = {
  /** 父会话里发起这次委派的工具调用 id */
  toolCallId: string;
  /** 子会话 id；点它打开子会话小窗 */
  sessionId: string;
  /** 任务简称；服务端已截断，可能为空 */
  description: string;
  status: ActivitySubagentStatus;
  /** 最近一步：子会话里最后一条有内容的消息（正文文本或工具名），没有就为空 */
  latest: string;
};

export type ActivityGoal = {
  status: GoalStatus;
  /** 目标本身；面板里铺两行 */
  objective: string;
  /** 暂停原因；`active` 时为空 */
  cause: GoalPauseCause | null;
  /** 服务端记的已续跑轮数 */
  turns: number;
  /** 目标开始后累计消耗的 token（含校验调用） */
  tokensUsed: number;
  /** token 预算；为空表示不限 */
  tokenBudget: number | null;
  /** 最近一轮带结论的记录；还在跑第一轮时为空 */
  latestTurn: GoalTurn | null;
};

export type SessionActivityView = {
  /** 进行中的在前，已结束的在后（各自保持插入顺序） */
  subagents: ActivitySubagentItem[];
  runningSubagents: number;
  /** 当前可连的后台服务；探不到的已由服务端移出清单，这里不区分状态 */
  services: BackgroundService[];
  /** 目标是否还在推进：`completed` 不算活动，它由对话里的「目标完成」细线负责 */
  goalActive: boolean;
  /** 目标段的展示数据；没有在推进的目标时为空 */
  goal: ActivityGoal | null;
  /** 悬浮摘要条是否出现：三块里任一有内容 */
  visible: boolean;
};

const statusOf = (stream: SubagentStream): ActivitySubagentStatus =>
  stream.done ? (stream.isError ? "failed" : "done") : "running";

/** 最近一步：从后往前找第一条有内容的条目，工具条目优先报工具名 */
const latestStepOf = (items: ChatItem[]): string => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.role === "tool" && item.toolName) return item.toolName;
    const text = itemText(item).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, LATEST_MAX_CHARS);
  }
  return "";
};

export const buildSessionActivity = (input: {
  subagents: SubagentStreams;
  services: readonly BackgroundService[];
  goal: GoalView | null;
  goalTurns: readonly GoalTurn[];
}): SessionActivityView => {
  const running: ActivitySubagentItem[] = [];
  const finished: ActivitySubagentItem[] = [];
  for (const [toolCallId, stream] of Object.entries(input.subagents)) {
    const item: ActivitySubagentItem = {
      toolCallId,
      sessionId: stream.sessionId,
      description: stream.description,
      status: statusOf(stream),
      latest: latestStepOf(stream.items),
    };
    (item.status === "running" ? running : finished).push(item);
  }

  const goal = input.goal;
  const goalActive = goal !== null && goal.status !== "completed";

  return {
    subagents: [...running, ...finished],
    runningSubagents: running.length,
    services: [...input.services],
    goalActive,
    goal:
      goal && goalActive
        ? {
            status: goal.status,
            objective: goal.objective,
            cause: goal.cause,
            turns: goal.turns,
            tokensUsed: goal.tokensUsed,
            tokenBudget: goal.tokenBudget,
            // 最近一轮的结论由 `verdict` / `completed` / `pause` 记录并进（见 `buildGoalTurns`）
            latestTurn:
              [...input.goalTurns].reverse().find((turn) => turn.outcome !== undefined) ?? null,
          }
        : null,
    visible: running.length + finished.length > 0 || input.services.length > 0 || goalActive,
  };
};
