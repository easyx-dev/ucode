/** 客户端统一错误类型与错误码文案渲染 */
import { errorMessageKey } from "@ucode/i18n";

/** 错误码 → 当前语言文案的翻译函数；未注入时回落服务端中文兜底 */
export type Translate = (key: string, params?: Record<string, string>) => string;

export type SdkErrorOptions = {
  /** 渲染文案所需的插值值 */
  params?: Record<string, string>;
  /** 错误详情（校验 issues、上游响应片段等） */
  details?: unknown;
  /** 传输层 HTTP 状态，仅用于诊断 */
  httpStatus?: number;
};

/**
 * 接口失败：承载封套里的 code / message / params / details。
 * `message` 是服务端中文兜底，展示文案应由 `describeError` 用注入的 `translate` 渲染。
 */
export class SdkError extends Error {
  readonly code: string;
  readonly params?: Record<string, string>;
  readonly details?: unknown;
  readonly httpStatus?: number;

  constructor(code: string, message: string, options: SdkErrorOptions = {}) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.params = options.params;
    this.details = options.details;
    this.httpStatus = options.httpStatus;
  }
}

export const isSdkError = (value: unknown): value is SdkError => value instanceof SdkError;

/** 按错误码取当前语言的文案；未登记的错误码回落服务端下发的中文兜底 */
export const describeError = (error: unknown, translate?: Translate): string => {
  if (!(error instanceof SdkError)) return String(error);
  const key = errorMessageKey(error.code);
  return key && translate ? translate(key, error.params) : error.message;
};

/** 按错误码与兜底文案解析展示文本（用于事件流的错误帧，那里没有 SdkError 实例） */
export const describeApiError = (
  code: string,
  message: string,
  params?: Record<string, string>,
  translate?: Translate,
): string => {
  const key = errorMessageKey(code);
  return key && translate ? translate(key, params) : message;
};

/** 把 `{{占位}}` 替换为 params；未注入 translate 时用于兜底文案 */
export const interpolate = (text: string, params?: Record<string, string>): string =>
  params ? text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => params[key] ?? match) : text;
