export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

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

export const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

export const fail = (code: string, message: string, details?: unknown): ApiResult<never> => ({
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});
