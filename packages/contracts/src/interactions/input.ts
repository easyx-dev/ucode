/** 交互（服务端提问、前端回答）的请求模型；按 `kind` 判别联合，后续追加 question 分支 */
import { z } from "zod";

import { PERMISSION_DECISIONS } from "../constants";
import { sessionIdSchema } from "../sessions/input";

/** 回答一条挂起的交互请求；`kind` 与待答请求一致，载荷随 kind 变化 */
export const interactionRespondInputSchema = z.discriminatedUnion("kind", [
  z.object({
    requestId: z.string().min(1),
    kind: z.literal("permission"),
    decision: z.enum(PERMISSION_DECISIONS),
  }),
]);

/** 列出某会话尚未回答的交互请求：刷新 / 重连后补齐对话框 */
export const interactionListInputSchema = z.object({ sessionId: sessionIdSchema });

export type InteractionRespondRequest = z.input<typeof interactionRespondInputSchema>;
export type InteractionRespondInput = z.infer<typeof interactionRespondInputSchema>;
export type InteractionListRequest = z.input<typeof interactionListInputSchema>;
export type InteractionListInput = z.infer<typeof interactionListInputSchema>;
