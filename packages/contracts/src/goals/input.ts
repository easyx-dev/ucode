/** 目标模式接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { GOAL_MAX_OBJECTIVE_LENGTH } from "../constants";
import { sessionIdSchema } from "../sessions/input";

/**
 * 设定 / 替换当前会话目标：`tokenBudget` 可选，正整数，缺省表示不设用量上限。
 * 目标会被当作「用户提供的任务数据」，不作为系统指令。
 */
export const goalSetInputSchema = z.object({
  sessionId: sessionIdSchema,
  objective: z.string().min(1).max(GOAL_MAX_OBJECTIVE_LENGTH),
  tokenBudget: z.number().int().positive().optional(),
});

export type GoalSetInput = z.infer<typeof goalSetInputSchema>;
export type GoalSetRequest = z.input<typeof goalSetInputSchema>;

/**
 * 只改当前会话目标的 token 预算（patch 语义）：不动轮数、校验结果与身份 id。
 * `tokenBudget` 传 null 即取消上限。
 */
export const goalBudgetInputSchema = z.object({
  sessionId: sessionIdSchema,
  tokenBudget: z.number().int().positive().nullable(),
});

export type GoalBudgetInput = z.infer<typeof goalBudgetInputSchema>;
export type GoalBudgetRequest = z.input<typeof goalBudgetInputSchema>;
