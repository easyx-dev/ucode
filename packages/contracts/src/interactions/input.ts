/** 交互（服务端提问、前端回答）的请求模型；按 `kind` 判别联合 */
import { z } from "zod";

import { PERMISSION_DECISIONS } from "../constants";
import { sessionIdSchema } from "../sessions/input";

/**
 * 回答一批提问：与请求里的 `questions` 同序，每项是该问题选中的选项标签或用户自填文本。
 * 单项为空数组表示用户跳过了这个问题。
 *
 * 不设数量 / 长度上限，与 opencode 的 `Reply.answers` 对齐；靠 `question` 工具的
 * 描述引导模型提问规模，而不是在服务端硬切。
 */
export const questionAnswersSchema = z.array(z.array(z.string()));

/** 回答一条挂起的交互请求；`kind` 与待答请求一致，载荷随 kind 变化 */
export const interactionRespondInputSchema = z.discriminatedUnion("kind", [
  z.object({
    requestId: z.string().min(1),
    kind: z.literal("permission"),
    decision: z.enum(PERMISSION_DECISIONS),
  }),
  z.object({
    requestId: z.string().min(1),
    kind: z.literal("question"),
    answers: questionAnswersSchema,
  }),
]);

/** 列出某会话尚未回答的交互请求：刷新 / 重连后补齐对话框 */
export const interactionListInputSchema = z.object({ sessionId: sessionIdSchema });

export type InteractionRespondRequest = z.input<typeof interactionRespondInputSchema>;
export type InteractionRespondInput = z.infer<typeof interactionRespondInputSchema>;
export type InteractionListRequest = z.input<typeof interactionListInputSchema>;
export type InteractionListInput = z.infer<typeof interactionListInputSchema>;
export type QuestionAnswers = z.infer<typeof questionAnswersSchema>;
