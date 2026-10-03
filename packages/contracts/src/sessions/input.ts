/** 会话接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { SESSION_MODES, THINKING_LEVELS } from "../constants";

/**
 * 会话 id 格式，与 pi 的 `assertValidSessionId` 一致。
 * 提前校验可以把非法 id 变成 400，而不是等到 SessionManager 抛错。
 */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);

/** 只带 sessionId 的操作（详情、归档、中断等） */
export const sessionIdInputSchema = z.object({ sessionId: sessionIdSchema });

/**
 * 会话分叉：`fromEntryId` 是源会话里的条目 id（消息 DTO 的 `id` 就是它），
 * 缺省取当前叶子；服务端对着条目树校验，非法即 400。
 */
export const sessionForkInputSchema = z.object({
  sessionId: sessionIdSchema,
  fromEntryId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export const sessionListInputSchema = z.object({
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
  /**
   * 列表的父子过滤：缺省只出根会话（`parentSessionId` 为空的）；
   * 传某个会话 id 时改为列出它的子会话。见 `plans/stage-7c-subagents.md`。
   */
  parentSessionId: sessionIdSchema.optional(),
});

export const sessionCreateInputSchema = z.object({
  name: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  mode: z.enum(SESSION_MODES).optional(),
});

export const sessionUpdateInputSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  mode: z.enum(SESSION_MODES).optional(),
});

export type SessionIdRequest = z.input<typeof sessionIdInputSchema>;
export type SessionIdInput = z.infer<typeof sessionIdInputSchema>;
export type SessionForkRequest = z.input<typeof sessionForkInputSchema>;
export type SessionForkInput = z.infer<typeof sessionForkInputSchema>;
export type SessionListInput = z.infer<typeof sessionListInputSchema>;
export type SessionListRequest = z.input<typeof sessionListInputSchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>;
export type SessionCreateRequest = z.input<typeof sessionCreateInputSchema>;
export type SessionUpdateInput = z.infer<typeof sessionUpdateInputSchema>;
export type SessionUpdateRequest = z.input<typeof sessionUpdateInputSchema>;
