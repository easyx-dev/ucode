/** 统一响应封套与业务异常 */
import { type ApiFailure, type ApiSuccess, OK_CODE } from "@ucode/contracts";

/**
 * 业务异常。`message` 是面向用户的中文兜底文案（服务端不做本地化，日志 / curl 直接可读）；
 * `params` 是客户端渲染该错误码文案所需的插值值，随封套 `params` 一并下发。
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly params?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
    params?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.params = params;
  }
}

export const ok = <T>(data: T): ApiSuccess<T> => ({
  success: true,
  code: OK_CODE,
  message: "",
  data,
});

/** 失败响应；错误详情通过 data 字段透出，插值值走 params */
export const fail = (
  code: string,
  message: string,
  data: unknown = null,
  params?: Record<string, string>,
): ApiFailure => ({
  success: false,
  code,
  message,
  data,
  ...(params ? { params } : {}),
});
