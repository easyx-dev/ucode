/** 消息接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { sessionIdSchema } from "../sessions/input";

export const messageListInputSchema = z.object({ sessionId: sessionIdSchema });

/**
 * 编辑一条已发送的用户消息并重发：`entryId` 是消息 DTO 的 id（即 pi 条目 id），
 * 服务端对着活动分支校验（不在活动分支 / 非用户消息一律 400）；旧分支保留在会话文件里。
 */
export const messageEditInputSchema = z.object({
  sessionId: sessionIdSchema,
  entryId: z.string().min(1),
  text: z.string().min(1),
});

/**
 * 发起一轮生成；服务端受理后返回 ack，生成在后台继续、结果走 /events。
 * 会话必须先由 `sessions/create` 建好（工作目录也是那时定的）——服务端不做隐式创建，
 * 创建只有一条路径，所以这里不带任何会话级设置。
 */
export const promptInputSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().min(1),
  /** 生成中再发消息时的投递方式 */
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
});

export type MessageListRequest = z.input<typeof messageListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
export type MessageEditRequest = z.input<typeof messageEditInputSchema>;
export type MessageEditInput = z.infer<typeof messageEditInputSchema>;
export type PromptInput = z.infer<typeof promptInputSchema>;
export type PromptRequest = z.input<typeof promptInputSchema>;
