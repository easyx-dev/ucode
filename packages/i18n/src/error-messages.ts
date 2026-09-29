/**
 * 错误码 → 文案 key。
 *
 * 服务端不再本地化：失败封套与 SSE 错误帧只带 `code` + 中文兜底 `message` + 插值 `params`。
 * 各端拿 `code` 在这里查到 key，再用 `t(key, params)` 渲染成当前语言。
 * 覆盖性由 `satisfies Record<ErrorCode, string>` 在编译期保证；映射到的 key 是否存在由
 * `scripts/verify` 校验。
 */
import type { ErrorCode } from "@ucode/contracts";

export const errorMessageKeys = {
  invalid_request: "请求参数无效",
  not_found: "接口不存在",
  internal_error: "内部错误",
  session_busy: "会话正忙",
  unknown_model: "模型不可用",
  model_not_configured: "尚未配置模型",
  unsupported_api: "不支持该api测试",
  upstream_unreachable: "上游不可达",
  upstream_error: "上游错误",
  invalid_config: "配置文件解析失败",
} as const satisfies Record<ErrorCode, string>;

/** key 的联合，供客户端 `t()` 的类型收窄 */
export type ErrorMessageKey = (typeof errorMessageKeys)[ErrorCode];

const byCode: Record<string, string> = errorMessageKeys;

/** 按错误码取文案 key；未登记的错误码返回 null（调用方回落服务端的 `message`） */
export const errorMessageKey = (code: string): ErrorMessageKey | null =>
  (byCode[code] as ErrorMessageKey | undefined) ?? null;
