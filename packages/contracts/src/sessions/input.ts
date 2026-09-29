/** 会话接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { THINKING_LEVELS } from "../constants";

/**
 * 会话 id 格式，与 pi 的 `assertValidSessionId` 一致。
 * 提前校验可以把非法 id 变成 400，而不是等到 SessionManager 抛错。
 */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);

/** 只带 sessionId 的操作（详情、删除、中断等） */
export const sessionIdInputSchema = z.object({ sessionId: sessionIdSchema });

export const sessionListInputSchema = z.object({
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export const sessionCreateInputSchema = z.object({
  name: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

export const sessionUpdateInputSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

export type SessionIdRequest = z.input<typeof sessionIdInputSchema>;
export type SessionIdInput = z.infer<typeof sessionIdInputSchema>;
export type SessionListInput = z.infer<typeof sessionListInputSchema>;
export type SessionListRequest = z.input<typeof sessionListInputSchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>;
export type SessionCreateRequest = z.input<typeof sessionCreateInputSchema>;
export type SessionUpdateInput = z.infer<typeof sessionUpdateInputSchema>;
export type SessionUpdateRequest = z.input<typeof sessionUpdateInputSchema>;
