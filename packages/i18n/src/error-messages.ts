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
  request_timeout: "请求超时，请重试",
  not_found: "接口不存在：{{path}}",
  internal_error: "服务内部错误",
  session_busy: "会话正在生成，请先中断或等本轮结束",
  compaction_failed: "压缩失败：{{reason}}",
  unknown_model: "模型不可用：{{ref}}",
  model_not_configured: "尚未配置模型，请先在设置里添加 provider",
  unsupported_api: "连通性测试不支持该 api 类型：{{api}}",
  upstream_unreachable: "无法连接 {{url}}",
  upstream_error: "上游返回 HTTP {{status}}",
  invalid_config: "配置文件解析失败：{{path}}",
  unauthorized: "登录已失效，请重新登录",
  invalid_credentials: "密码错误",
  forbidden: "没有权限执行该操作",
  pairing_invalid: "配对链接无效或已使用",
  pairing_expired: "配对链接已过期，请重新生成",
  rate_limited: "操作过于频繁，请稍后再试",
  path_not_found: "路径不存在：{{path}}",
  path_exists: "目录已存在：{{path}}",
  mkdir_failed: "创建目录失败：{{path}}",
  project_not_found: "项目不存在：{{path}}",
  not_a_file: "不是普通文件：{{path}}",
  not_a_repository: "目录不在 git 仓库内：{{path}}",
  git_unavailable: "未找到 git 可执行文件",
  git_failed: "git 执行失败",
  image_invalid: "图片无效：{{reason}}",
  payload_too_large: "附件超过大小上限（{{max}}）",
} as const satisfies Record<ErrorCode, string>;

/** key 的联合，供客户端 `t()` 的类型收窄 */
export type ErrorMessageKey = (typeof errorMessageKeys)[ErrorCode];

const byCode: Record<string, string> = errorMessageKeys;

/** 按错误码取文案 key；未登记的错误码返回 null（调用方回落服务端的 `message`） */
export const errorMessageKey = (code: string): ErrorMessageKey | null =>
  (byCode[code] as ErrorMessageKey | undefined) ?? null;
