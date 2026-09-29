/** 统一响应封套与业务异常 */
import { type ApiFailure, type ApiSuccess, OK_CODE } from "@ucode/contracts";

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ok = <T>(data: T): ApiSuccess<T> => ({
  success: true,
  code: OK_CODE,
  message: "",
  data,
});

/** 失败响应；错误详情通过 data 字段透出 */
export const fail = (code: string, message: string, data: unknown = null): ApiFailure => ({
  success: false,
  code,
  message,
  data,
});
