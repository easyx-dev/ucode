/** HTTP 传输层：拼接 base、注入 token 与自定义头、拆解响应封套 */
import { API_BASE_PATH, type ApiResponse, ERROR_CODES } from "@ucode/contracts";

import { ApiError, interpolate, type Translate } from "./error";

export type FetchLike = typeof fetch;

export type TransportOptions = {
  /** 服务根地址；缺省同源（空串），桌面端传 http://127.0.0.1:<port> */
  baseUrl?: string;
  /** 注入的 fetch；缺省用全局 fetch */
  fetch?: FetchLike;
  /** 附加到每个请求的头 */
  headers?: Record<string, string>;
  /** 鉴权令牌读取器：`serviceToken`（原生客户端）与会话 token（浏览器）都经它进 `Authorization: Bearer`；可同步可异步 */
  getToken?: () => string | null | Promise<string | null>;
  /** 收到 401 时的回调：客户端据此切换为未登录态并跳登录页 */
  onUnauthorized?: () => void;
  /** 错误兜底文案的翻译函数；未注入时用中文模板插值 */
  translate?: Translate;
  /** 请求超时毫秒数；缺省 30s，`0` 表示不设超时（长连接） */
  timeoutMs?: number;
};

/** 单个请求的超时覆盖 */
export type RequestOptions = {
  /** 毫秒；缺省用 `TransportOptions.timeoutMs` */
  timeoutMs?: number;
};

export type Transport = {
  /** POST JSON 并拆封套 */
  post: <T>(action: string, body?: unknown, request?: RequestOptions) => Promise<T>;
  /** POST 原始字节（附件上传），响应仍走 JSON 封套 */
  postBinary: <T>(
    action: string,
    body: Blob,
    query?: Record<string, string>,
    request?: RequestOptions,
  ) => Promise<T>;
  /** POST 并返回流（事件流），不解析封套 */
  postStream: (
    action: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  /** GET 并拆封套 */
  get: <T>(action: string, request?: RequestOptions) => Promise<T>;
  /** GET 原始字节（附件读取）；响应非 JSON，不走封套 */
  getBlob: (action: string, request?: RequestOptions) => Promise<Blob>;
  /**
   * POST JSON 并原样返回响应体，**不拆封套**。
   * 只给插件自有接口用：那套协议由插件定义，宿主不替它规定封套。
   */
  postRaw: <T>(action: string, body?: unknown, request?: RequestOptions) => Promise<T>;
  /**
   * 把「相对接口基址的路径」拼成可直接请求的绝对路径（插件托管的模块与样式用它）。
   * 不拆封套、不带鉴权头：结果只用于 `import()` / `<link>`，凭证由浏览器的同源规则带上。
   */
  resolve: (path: string) => string;
};

/**
 * 请求超时缺省值。本地服务的接口都很快，超过这个时间基本是连接半死；
 * 已知慢的接口（拉上游模型目录、附件上传）在调用处单独放宽。
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export const createTransport = (options: TransportOptions = {}): Transport => {
  const root = (options.baseUrl ?? "").replace(/\/+$/, "");
  const base = `${root}${API_BASE_PATH}`;
  const doFetch = options.fetch ?? globalThis.fetch;

  /** 按 key 取当前语言文案；未注入 translate 时用中文模板插值 */
  const message = (key: string, params?: Record<string, string>): string =>
    options.translate ? options.translate(key, params) : interpolate(key, params);

  const requestHeaders = async (contentType?: string): Promise<Record<string, string>> => {
    const token = options.getToken ? await options.getToken() : null;
    return {
      ...(contentType ? { "content-type": contentType } : {}),
      ...options.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };

  /** 拆封套：success 为真返回 data，否则抛 ApiError；失败详情挂在 details 上 */
  const unwrap = async <T>(response: Response): Promise<T> => {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // 非 JSON 的 401（如反向代理）无法分辨原因，按未认证处理
      if (response.status === 401) options.onUnauthorized?.();
      throw new ApiError(
        "invalid_response",
        message("服务返回了非 JSON 响应（HTTP {{status}}）", { status: String(response.status) }),
        {
          httpStatus: response.status,
        },
      );
    }

    const record = payload as ApiResponse<T> | null;
    if (record?.success) return record.data;

    // 只有「未认证」才切全局登出：登录 / 改密码的 invalid_credentials 同为 401，但会话仍然有效
    if (response.status === 401 && record?.code === ERROR_CODES.unauthorized) {
      options.onUnauthorized?.();
    }

    throw new ApiError(
      record?.code ?? "unknown_error",
      record?.message ??
        message("请求失败（HTTP {{status}}）", { status: String(response.status) }),
      { details: record?.data, params: record?.params, httpStatus: response.status },
    );
  };

  /** 读取失败响应体里的原因与业务码，拿不到就退回状态码 */
  const readStreamError = async (
    response: Response,
  ): Promise<{ message: string; code: string }> => {
    try {
      const body = (await response.json()) as { message?: string; code?: string };
      return {
        message:
          body.message ??
          message("事件流连接失败（HTTP {{status}}）", {
            status: String(response.status),
          }),
        code: body.code ?? "events_failed",
      };
    } catch {
      return {
        message: message("事件流连接失败（HTTP {{status}}）", { status: String(response.status) }),
        code: "events_failed",
      };
    }
  };

  /**
   * 发请求并处理超时。超时（`AbortSignal.timeout` 触发）映射成可读的业务错误；
   * 其它异常原样抛出，由调用方决定怎么报。
   */
  const send = async (
    url: string,
    init: RequestInit,
    timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<Response> => {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    try {
      return await doFetch(url, { ...init, ...(signal ? { signal } : {}) });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ApiError(ERROR_CODES.requestTimeout, message("请求超时，请重试"), {
          httpStatus: 0,
        });
      }
      throw error;
    }
  };

  return {
    async post<T>(action: string, body: unknown = {}, request?: RequestOptions): Promise<T> {
      const response = await send(
        `${base}/${action}`,
        {
          method: "POST",
          headers: await requestHeaders("application/json"),
          body: JSON.stringify(body),
        },
        request?.timeoutMs,
      );
      return unwrap<T>(response);
    },
    async postBinary<T>(
      action: string,
      body: Blob,
      query?: Record<string, string>,
      request?: RequestOptions,
    ): Promise<T> {
      const search = query ? `?${new URLSearchParams(query).toString()}` : "";
      const response = await send(
        `${base}/${action}${search}`,
        {
          method: "POST",
          headers: await requestHeaders(body.type || "application/octet-stream"),
          body,
        },
        request?.timeoutMs,
      );
      return unwrap<T>(response);
    },
    async postStream(
      action: string,
      body: unknown,
      signal: AbortSignal,
    ): Promise<ReadableStream<Uint8Array>> {
      const response = await doFetch(`${base}/${action}`, {
        method: "POST",
        headers: await requestHeaders("application/json"),
        body: JSON.stringify(body ?? {}),
        signal,
      });
      if (!response.ok) {
        const failure = await readStreamError(response);
        if (response.status === 401 && failure.code === ERROR_CODES.unauthorized) {
          options.onUnauthorized?.();
        }
        throw new ApiError("events_failed", failure.message, {
          httpStatus: response.status,
        });
      }
      if (!response.body) {
        throw new ApiError("events_failed", message("服务未返回流"));
      }
      return response.body;
    },
    async get<T>(action: string, request?: RequestOptions): Promise<T> {
      const response = await send(
        `${base}/${action}`,
        { headers: await requestHeaders() },
        request?.timeoutMs,
      );
      return unwrap<T>(response);
    },
    async postRaw<T>(action: string, body?: unknown, request?: RequestOptions): Promise<T> {
      const response = await send(
        `${base}/${action}`,
        {
          method: "POST",
          headers: await requestHeaders("application/json"),
          body: JSON.stringify(body ?? {}),
        },
        request?.timeoutMs,
      );
      if (!response.ok) {
        if (response.status === 401) options.onUnauthorized?.();
        const detail = await response.text().catch(() => "");
        throw new ApiError(
          "plugin_request_failed",
          message("插件接口返回 HTTP {{status}}", { status: String(response.status) }),
          { httpStatus: response.status, details: detail.slice(0, 500) },
        );
      }
      return (await response.json()) as T;
    },
    async getBlob(action: string, request?: RequestOptions): Promise<Blob> {
      const response = await send(
        `${base}/${action}`,
        { headers: await requestHeaders() },
        request?.timeoutMs,
      );
      if (!response.ok) {
        // 二进制接口的失败体形不成封套（404 是空体），只按状态处理，不另造一套拆解
        if (response.status === 401) options.onUnauthorized?.();
        throw new ApiError(
          "attachment_failed",
          message("附件读取失败（HTTP {{status}}）", { status: String(response.status) }),
          { httpStatus: response.status },
        );
      }
      return response.blob();
    },
    resolve: (path: string) => `${base}/${path.replace(/^\/+/, "")}`,
  };
};
