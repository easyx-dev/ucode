import { z } from "zod";

/**
 * 响应形状（spec §4.4）。
 *
 * 三类响应形态：成功、失败（带可诊断错误标识）、**解析失败**。
 * 解析失败时 `command` 为 `"parse"` 且 **没有 id**——因为无法得知 id。
 */
export const ErrorInfoSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

export const ResponseSchema = z.object({
  type: z.literal("response"),
  /** 解析失败时为 null（spec §4.4）。 */
  id: z.string().nullable(),
  /** 解析失败时为 "parse"。 */
  command: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: ErrorInfoSchema.optional(),
});
export type Response = z.infer<typeof ResponseSchema>;

/**
 * 可诊断的错误标识。
 * 用途是让"操作被拒"能区分"承载不了"与"信任不足"，以及"参数问题"与"内部故障"。
 */
export const ERROR_CODES = {
  parse_error: "消息不是合法的协议 C 消息。",
  unknown_command: "命令名不在协议 C 的命令清单里。",
  invalid_args: "命令参数不合法。",
  unsupported_capability: "这条通路的信任级别不足以执行该操作（能力未授予）。",
  autonomy_denied: "该会话的自主级别不允许由这条通路驱动（自主级别门槛）。",
  no_interaction_capacity: "当前没有可承载交互的 attachment，已按降级策略处置。",
  interaction_timeout: "交互请求超时。",
  not_attached: "这条连接没有挂载到该会话。",
  session_not_found: "会话不存在。",
  session_not_owned: "本实例不是该会话的 owner，不能写入。",
  session_busy: "会话正在运行中，该操作暂不可用。",
  unsupported_reference: "该引用类型尚未实现（首发只支持文件与文件夹）。",
  unsupported_channel: "该通道在这条通路上不可用。",
  internal_error: "核心层内部错误。",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorInfo(code: ErrorCode, message?: string, details?: unknown): ErrorInfo {
  return {
    code,
    message: message ?? ERROR_CODES[code],
    ...(details === undefined ? {} : { details }),
  };
}

export function okResponse(id: string, command: string, data?: unknown): Response {
  return { type: "response", id, command, success: true, ...(data === undefined ? {} : { data }) };
}

export function errorResponse(
  id: string | null,
  command: string,
  code: ErrorCode,
  message?: string,
  details?: unknown,
): Response {
  return {
    type: "response",
    id,
    command,
    success: false,
    error: errorInfo(code, message, details),
  };
}

/** 解析失败专用：没有 id，命令名固定为 "parse"。 */
export function parseErrorResponse(message?: string, details?: unknown): Response {
  return errorResponse(null, "parse", "parse_error", message, details);
}
