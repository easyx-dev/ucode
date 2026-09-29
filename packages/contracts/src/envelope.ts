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
  /** 业务错误码，前端按此分支而不依赖 HTTP 状态 */
  code: string;
  /** 面向用户的错误文案 */
  message: string;
  /** 错误详情（校验 issues、上游响应片段等），无详情时为 null */
  data: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 成功响应的固定业务码 */
export const OK_CODE = "ok";

/**
 * 业务错误码表。HTTP 状态码只表达传输层语义，具体失败原因一律看 code，
 * 因此新增错误时先在这里登记，避免各处散落字符串字面量。
 */
export const ERROR_CODES = {
  /** 请求参数校验失败 */
  invalidRequest: "invalid_request",
  /** 资源或路由不存在 */
  notFound: "not_found",
  /** 服务端未预期异常 */
  internal: "internal_error",
  /** 会话正在生成，需先中断 */
  sessionBusy: "session_busy",
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
} as const;
