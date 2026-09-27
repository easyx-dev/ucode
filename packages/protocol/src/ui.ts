import { z } from "zod";

/**
 * 交互面（spec §4.6）：**方向与命令面相反——服务层发起，控制层应答**。
 *
 * 分两类，可靠性要求完全不同：
 * - **阻塞式**（ui.request / ui.response）：需要应答、按标识配对；丢一次权限确认会让 agent 永久挂起。
 * - **通知式**（notify / status / widget / title / set_editor_text）：发完即忘，可以丢。
 */

/** 阻塞式交互的四种方法。 */
export const UiMethodSchema = z.enum(["select", "confirm", "input", "editor"]);
export type UiMethod = z.infer<typeof UiMethodSchema>;

export const UiSelectParamsSchema = z.object({
  title: z.string(),
  options: z.array(z.string()).min(1),
  /** 0 或省略 = 不超时（由服务层按降级策略处置）。 */
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const UiConfirmParamsSchema = z.object({
  title: z.string(),
  message: z.string(),
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const UiInputParamsSchema = z.object({
  title: z.string(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const UiEditorParamsSchema = z.object({
  title: z.string(),
  prefill: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const UiRequestSchema = z.object({
  type: z.literal("ui.request"),
  id: z.string(),
  sessionId: z.string().nullable(),
  method: UiMethodSchema,
  params: z.union([
    UiSelectParamsSchema,
    UiConfirmParamsSchema,
    UiInputParamsSchema,
    UiEditorParamsSchema,
  ]),
  /** 发起这条请求的语义来源，用于审计与界面提示。 */
  origin: z.enum(["permission", "question", "tool", "host"]).default("host"),
});
export type UiRequest = z.infer<typeof UiRequestSchema>;

export const UiResponseSchema = z.object({
  type: z.literal("ui.response"),
  id: z.string(),
  /** 用户取消（超时降级、窗口关闭）与"回答了空值"是两件不同的事。 */
  cancelled: z.boolean().default(false),
  value: z.union([z.string(), z.boolean(), z.null()]).default(null),
  /** 应答者标识（多 attachment 广播时用于审计"谁应答的"）。 */
  responderId: z.string().nullable().default(null),
});
export type UiResponse = z.infer<typeof UiResponseSchema>;

/**
 * 关闭一条已发出的交互请求。
 *
 * 已认证 attachment 上的交互请求是**广播**的：所有 attachment 都显示，首个应答生效，
 * **其余同步关闭**（spec §2.6）。这条消息就是"同步关闭"的载体——没有它，其他壳子的弹窗
 * 会一直挂着，用户以为还需要自己点。
 */
export const UiCancelSchema = z.object({
  type: z.literal("ui.cancel"),
  id: z.string(),
  reason: z.enum(["answered", "timeout", "withdrawn"]),
});

export const UiNotifySchema = z.object({
  type: z.literal("ui.notify"),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  sessionId: z.string().nullable().default(null),
});

export const UiStatusSchema = z.object({
  type: z.literal("ui.status"),
  key: z.string(),
  value: z.string().nullable(),
  sessionId: z.string().nullable().default(null),
});

export const UiWidgetSchema = z.object({
  type: z.literal("ui.widget"),
  id: z.string(),
  content: z.unknown(),
  sessionId: z.string().nullable().default(null),
});

export const UiTitleSchema = z.object({
  type: z.literal("ui.title"),
  value: z.string(),
});

export const UiSetEditorTextSchema = z.object({
  type: z.literal("ui.set_editor_text"),
  value: z.string(),
  sessionId: z.string().nullable().default(null),
});

/** 服务端 → 控制层的交互类消息。 */
export const UiServerMessageSchema = z.discriminatedUnion("type", [
  UiRequestSchema,
  UiCancelSchema,
  UiNotifySchema,
  UiStatusSchema,
  UiWidgetSchema,
  UiTitleSchema,
  UiSetEditorTextSchema,
]);
export type UiServerMessage = z.infer<typeof UiServerMessageSchema>;
