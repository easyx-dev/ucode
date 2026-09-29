/** 消息接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { sessionIdSchema } from "../sessions/input";

export const messageListInputSchema = z.object({ sessionId: sessionIdSchema });

/** 发起一轮生成；SSE 流式返回 */
export const promptInputSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().min(1),
  /** 生成中再发消息时的投递方式 */
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
  /** 仅新建会话时生效的工作目录 */
  cwd: z.string().min(1).optional(),
});

export type MessageListRequest = z.input<typeof messageListInputSchema>;
export type PromptInput = z.infer<typeof promptInputSchema>;
export type PromptRequest = z.input<typeof promptInputSchema>;
