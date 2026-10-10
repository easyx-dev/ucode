/**
 * 目标模式接口的响应模型。
 *
 * `GoalView` 是给前端的完整视图：状态机字段来自 `session.goal_state`，
 * `tokensUsed` 则由使用统计现算（goal 起始时间之后的累计）。
 */
import type { GoalPauseCause, GoalStatus } from "../constants";

/** 一次校验的结果；`nextStep` 是校验给出的下一步动作，未达成时才有意义 */
export type GoalVerification = {
  achieved: boolean;
  reason: string;
  nextStep: string;
  /** 校验时间（ISO 8601） */
  at: string;
};

export type GoalView = {
  objective: string;
  status: GoalStatus;
  /** 暂停原因；`active` / `completed` 时为空 */
  cause: GoalPauseCause | null;
  /** 已自动续跑的轮数（不含用户触发的那轮） */
  turns: number;
  /** token 预算；为空表示不限 */
  tokenBudget: number | null;
  /** 目标开始后本会话累计消耗的 token（含校验调用） */
  tokensUsed: number;
  /** 目标设定时间（ISO 8601），也是用量统计的起点 */
  startedAt: string;
  updatedAt: string;
  /** 最近一次校验结果；还没校验过时为空 */
  verification: GoalVerification | null;
};

/** 目标操作（设置 / 查看 / 暂停 / 恢复 / 清除）的统一响应 */
export type GoalResponse = {
  sessionId: string;
  /** 当前目标；已清除或从未设置时为空 */
  goal: GoalView | null;
};
