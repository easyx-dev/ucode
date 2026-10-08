/** 消息接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { PROMPT_MAX_ATTACHMENTS, PROMPT_MAX_CONTEXTS } from "../constants";
import { sessionIdSchema } from "../sessions/input";

export const messageListInputSchema = z.object({ sessionId: sessionIdSchema });

/**
 * 附件引用：`id` 是上传接口返回的内容 hash（64 位小写 hex，sha256）。
 * 图片与非图片都用同一套引用；服务端按入库的 mimeType 决定发给模型还是只做引用。
 */
export const attachmentRefSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
});

/** `@` 上下文引用：绝对路径或工作目录相对路径 + 可选行范围；服务端读内容后前置进正文 */
export const contextRefSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

/**
 * 编辑一条已发送的用户消息并重发：`entryId` 是消息 DTO 的 id（即 pi 条目 id），
 * 服务端对着活动分支校验（不在活动分支 / 非用户消息一律 400）；旧分支保留在会话文件里。
 *
 * `contexts` / `attachments` 与 `promptInputSchema` 同形：原消息里的 `@` 引用与附件由编辑器还原后
 * 一并回传，重发时才不会丢掉它们（附件只需 id——引用按内容寻址，重建不需要其余视图信息）。
 * `text` 必填：编辑的意义就是改正文，原样重发没有意义。
 */
export const messageEditInputSchema = z.object({
  sessionId: sessionIdSchema,
  entryId: z.string().min(1),
  text: z.string().min(1),
  contexts: z.array(contextRefSchema).max(PROMPT_MAX_CONTEXTS).optional(),
  attachments: z.array(attachmentRefSchema).max(PROMPT_MAX_ATTACHMENTS).optional(),
});

/**
 * 发起一轮生成；服务端受理后返回 ack，生成在后台继续、结果走 /events。
 * 会话必须先由 `sessions/create` 建好（工作目录也是那时定的）——服务端不做隐式创建，
 * 创建只有一条路径，所以这里不带任何会话级设置。
 *
 * `text` 允许为空串：只要 `contexts` 或 `attachments` 非空即可；「三者至少一项」由路由层校验，
 * 这样纯附件 / 纯引用消息也能发送。
 */
export const promptInputSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().default(""),
  contexts: z.array(contextRefSchema).max(PROMPT_MAX_CONTEXTS).optional(),
  attachments: z.array(attachmentRefSchema).max(PROMPT_MAX_ATTACHMENTS).optional(),
  /** 生成中再发消息时的投递方式 */
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
});

/**
 * 手动压缩上下文；`instructions` 可给自定义总结要求，省略即用默认总结。
 * 与生成一样只做受理，压缩在服务端后台执行、结果走 /events（`compaction_start` / `compaction_end`）。
 */
export const messageCompactInputSchema = z.object({
  sessionId: sessionIdSchema,
  instructions: z.string().trim().min(1).optional(),
});

export type MessageListRequest = z.input<typeof messageListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
export type MessageEditRequest = z.input<typeof messageEditInputSchema>;
export type MessageEditInput = z.infer<typeof messageEditInputSchema>;
export type MessageCompactRequest = z.input<typeof messageCompactInputSchema>;
export type MessageCompactInput = z.infer<typeof messageCompactInputSchema>;

/**
 * 批准计划：模式由客户端先经 `sessions/update` 切回 `build`，这里只负责注入
 * 「计划已批准，请开始执行。」并起一轮——自定义条目只有服务端写得进去。
 */
export const messageApprovePlanInputSchema = z.object({ sessionId: sessionIdSchema });

export type MessageApprovePlanRequest = z.input<typeof messageApprovePlanInputSchema>;
export type MessageApprovePlanInput = z.infer<typeof messageApprovePlanInputSchema>;
export type AttachmentRefInput = z.infer<typeof attachmentRefSchema>;
export type AttachmentRefRequest = z.input<typeof attachmentRefSchema>;
export type AttachmentRef = AttachmentRefInput;
export type ContextRefInput = z.infer<typeof contextRefSchema>;
export type ContextRefRequest = z.input<typeof contextRefSchema>;
export type ContextRef = ContextRefInput;
export type PromptInput = z.infer<typeof promptInputSchema>;
export type PromptRequest = z.input<typeof promptInputSchema>;
