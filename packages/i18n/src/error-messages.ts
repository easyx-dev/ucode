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
  asset_name_invalid: "资产名不合法：{{reason}}",
  asset_read_only: "该来源的资产不可编辑：{{path}}",
  asset_content_invalid: "资产内容校验失败：{{reason}}",
  not_a_repository: "目录不在 git 仓库内：{{path}}",
  git_unavailable: "未找到 git 可执行文件",
  git_failed: "git 执行失败",
  terminal_not_found: "终端不存在或已结束",
  terminal_limit: "终端数量已达上限",
  image_invalid: "图片无效：{{reason}}",
  payload_too_large: "附件超过大小上限（{{max}}）",
  plugin_not_found: "插件不存在：{{id}}",
  plugin_manifest_invalid: "插件清单无效：{{path}}",
  plugin_component_invalid: "插件组件路径无效：{{path}}",
  plugin_source_invalid: "插件来源不受支持：{{source}}",
  marketplace_invalid: "市场配置无效：{{reason}}",
  browser_profile_invalid: "浏览器 profile 名不合法：{{reason}}",
  browser_profile_in_use: "该 profile 正在使用中，请先关掉对应实例",
  hub_unreachable: "无法连接中继 {{url}}：{{reason}}",
  hub_login_failed: "中继登录失败：{{reason}}",
  hub_register_failed: "在中继登记本机设备失败：{{reason}}",
  hub_not_configured: "未配置中继地址：请填写中继服务地址后再登录",
  hub_not_bound: "本机还没有绑定中继设备：请先登录中继",
  hub_models_empty: "中继没有可用的模型：请先在中继后台配置 AI 厂商",
} as const satisfies Record<ErrorCode, string>;

/** key 的联合，供客户端 `t()` 的类型收窄 */
export type ErrorMessageKey = (typeof errorMessageKeys)[ErrorCode];

const byCode: Record<string, string> = errorMessageKeys;

/** 按错误码取文案 key；未登记的错误码返回 null（调用方回落服务端的 `message`） */
export const errorMessageKey = (code: string): ErrorMessageKey | null =>
  (byCode[code] as ErrorMessageKey | undefined) ?? null;
