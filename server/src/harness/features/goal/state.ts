/**
 * 会话目标的状态机：解析存储 JSON、状态迁移与上限判定。
 *
 * 状态以 JSON 存在 `session.goal_state`（见 plans/stage-11-goal.md），
 * 这里只做纯数据操作；持久化与事件由 `GoalService` 负责。
 * 迁移函数一律返回新对象，调用方拿到即可直接落库。
 */

import { randomUUID } from "node:crypto";
import {
  GOAL_MAX_OBJECTIVE_LENGTH,
  GOAL_PAUSE_CAUSES,
  GOAL_STATUSES,
  type GoalPauseCause,
  type GoalVerification,
} from "@ucode/contracts";
import { z } from "zod";

const verificationSchema: z.ZodType<GoalVerification> = z.object({
  achieved: z.boolean(),
  reason: z.string(),
  nextStep: z.string(),
  at: z.string(),
});

/**
 * 存储里的目标状态；`noProgress` / `lastText` 供无进展守卫使用，不下发前端。
 * `id` 是本次目标的身份：设定与恢复各轮换一次，用来作废「替换 / 暂停 / 清除后迟到的旧校验」。
 */
export const goalStateSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1).max(GOAL_MAX_OBJECTIVE_LENGTH),
  status: z.enum(GOAL_STATUSES),
  cause: z.enum(GOAL_PAUSE_CAUSES).nullable(),
  turns: z.number().int().nonnegative(),
  tokenBudget: z.number().int().positive().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  verification: verificationSchema.nullable(),
  /** 连续无工具调用的轮数 */
  noProgress: z.number().int().nonnegative(),
  /** 上一轮的正文指纹（规范化后），用于判断是否原样重复 */
  lastText: z.string(),
  /**
   * 本轮开始时目标的累计用量，用来算「本轮用量增量」。
   * 带默认值：存量目标没有这个字段，加必填会让它们被当成「无目标」。
   */
  tokensAtTurnStart: z.number().int().nonnegative().default(0),
  /** 本轮开始时刻（ISO 8601），与下一轮起点的时刻差即本轮耗时；存量目标为空串 */
  turnStartedAt: z.string().default(""),
});

export type GoalState = z.infer<typeof goalStateSchema>;

/** 解析存储的 JSON；为空 / 损坏 / 结构不符时按「没有目标」处理，不打断接口 */
export const parseGoalState = (raw: string | null): GoalState | null => {
  if (!raw) return null;
  try {
    const parsed = goalStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const serializeGoalState = (state: GoalState): string => JSON.stringify(state);

/** 设定 / 替换目标：重置计数与校验结果，状态为 `active`，并轮换身份 id */
export const startGoal = (
  objective: string,
  tokenBudget: number | null,
  now = new Date().toISOString(),
): GoalState => ({
  id: randomUUID(),
  objective,
  status: "active",
  cause: null,
  turns: 0,
  tokenBudget,
  startedAt: now,
  updatedAt: now,
  verification: null,
  noProgress: 0,
  lastText: "",
  tokensAtTurnStart: 0,
  turnStartedAt: now,
});

export const pauseGoal = (
  state: GoalState,
  cause: GoalPauseCause,
  now = new Date().toISOString(),
): GoalState => ({ ...state, status: "paused", cause, updatedAt: now });

/**
 * 恢复并轮换身份 id：暂停期间迟到的旧校验据此作废。
 * 无进展计数随恢复归零（暂停期间的空等不该继续累计），轮数与校验结果保留；
 * `tokensAtTurnStart` 由调用方回填——纯函数拿不到用量。
 */
export const resumeGoal = (state: GoalState, now = new Date().toISOString()): GoalState => ({
  ...state,
  id: randomUUID(),
  status: "active",
  cause: null,
  noProgress: 0,
  lastText: "",
  turnStartedAt: now,
  updatedAt: now,
});

export const completeGoal = (
  state: GoalState,
  verification: GoalVerification,
  now = new Date().toISOString(),
): GoalState => ({
  ...state,
  status: "completed",
  cause: null,
  verification,
  noProgress: 0,
  lastText: "",
  updatedAt: now,
});

/** 记录一次校验结果（未达成时用），同时带上无进展计数 */
export const recordVerification = (
  state: GoalState,
  verification: GoalVerification,
  progress: { noProgress: number; lastText: string },
  now = new Date().toISOString(),
): GoalState => ({ ...state, verification, ...progress, updatedAt: now });

/** 记一次自动续跑：轮数递增、记下本轮起点，返回新状态 */
export const advanceTurn = (
  state: GoalState,
  tokensUsed: number,
  now = new Date().toISOString(),
): GoalState => ({
  ...state,
  turns: state.turns + 1,
  tokensAtTurnStart: tokensUsed,
  turnStartedAt: now,
  updatedAt: now,
});
