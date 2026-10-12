/** 非流式接口的统一出参封套：成功与失败共用 success / code / message / data 四字段 */
export type ApiSuccess<T> = {
  /** 业务成功标记 */
  success: true;
  /** 业务码，成功固定为 OK_CODE */
  code: string;
  /** 面向用户的提示文案，成功时为空串 */
  message: string;
  /** 业务数据 */
  data: T;
};

export type ApiFailure = {
  /** 业务成功标记，失败恒为 false */
  success: false;
  /** 业务错误码，客户端按此分支而不依赖 HTTP 状态 */
  code: string;
  /**
   * 面向用户的中文兜底文案（服务端不本地化）。
   * 客户端按 `code` 查 `@ucode/i18n` 的 errorMessageKeys 自行渲染；查不到时用它。
   */
  message: string;
  /** 错误详情（校验 issues、上游响应片段等），无详情时为 null */
  data: unknown;
  /** 渲染 `message` 所需的插值值（如 url / status / ref），由客户端按 code 的文案使用 */
  params?: Record<string, string>;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 成功响应的固定业务码 */
export const OK_CODE = "ok";

/**
 * 业务错误码表。HTTP 状态码只表达传输层语义，具体失败原因一律看 code，
 * 因此新增错误时先在这里登记，避免各处散落字符串字面量。
 * 按域分组、组间空行分隔；码值为 snake_case，取自域名或动作名。
 */
export const ERROR_CODES = {
  /** 请求参数校验失败 */
  invalidRequest: "invalid_request",
  /** 资源或路由不存在 */
  notFound: "not_found",
  /** 服务端未预期异常 */
  internal: "internal_error",
  /** 请求超时（客户端传输层判定，服务端不会返回该码） */
  requestTimeout: "request_timeout",

  /** 会话正在生成，需先中断 */
  sessionBusy: "session_busy",
  /** 上下文压缩失败（内容太少、已压缩过、总结调用失败等） */
  compactionFailed: "compaction_failed",

  /** 指定的模型不可用 */
  unknownModel: "unknown_model",
  /** 尚未配置任何可用模型 */
  modelNotConfigured: "model_not_configured",

  /** 连通性测试不支持该 api 类型 */
  unsupportedApi: "unsupported_api",
  /** 无法连接上游端点 */
  upstreamUnreachable: "upstream_unreachable",
  /** 上游返回非 2xx */
  upstreamError: "upstream_error",

  /** 配置文件解析失败 */
  invalidConfig: "invalid_config",

  /** 未认证：缺少或无效的凭证 */
  unauthorized: "unauthorized",
  /** 登录密码错误 */
  invalidCredentials: "invalid_credentials",
  /** 权限不足（角色 / 权限分级预留） */
  forbidden: "forbidden",
  /** 配对码不存在或已使用 */
  pairingInvalid: "pairing_invalid",
  /** 配对码已过期 */
  pairingExpired: "pairing_expired",
  /** 请求过于频繁，触发了限流 */
  rateLimited: "rate_limited",

  /** 路径不存在，或存在但不是目录 */
  pathNotFound: "path_not_found",
  /** 要创建的目录已存在 */
  pathExists: "path_exists",
  /** 创建目录失败（权限、只读等） */
  mkdirFailed: "mkdir_failed",
  /** 指定的项目空间不存在 */
  projectNotFound: "project_not_found",
  /** 路径存在但不是普通文件（目录 / 特殊文件） */
  notAFile: "not_a_file",

  /** 目标目录不是 git 仓库（或不在仓库内） */
  notARepository: "not_a_repository",
  /** 机器上没有可用的 git */
  gitUnavailable: "git_unavailable",
  /** git 命令执行失败 */
  gitFailed: "git_failed",

  /** 图片无法归一化（格式不支持、超限且不可压缩等） */
  imageInvalid: "image_invalid",
  /** 上传体积超过上限 */
  payloadTooLarge: "payload_too_large",

  /** 插件未登记或已被移除 */
  pluginNotFound: "plugin_not_found",
  /** 插件清单缺失、无法解析或字段非法 */
  pluginManifestInvalid: "plugin_manifest_invalid",
  /** 插件组件不在插件根内，或声明的路径不存在 */
  pluginComponentInvalid: "plugin_component_invalid",
  /** 安装来源不受支持（尚未实现的来源，或来源本身不可用） */
  pluginSourceInvalid: "plugin_source_invalid",
  /** 市场未登记、来源不受支持或清单读不出来 */
  marketplaceInvalid: "marketplace_invalid",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
