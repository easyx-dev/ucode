/** HTTP 传输层：拼接 base、注入 token 与自定义头、拆解响应封套 */
import { API_BASE_PATH, type ApiResponse } from "@ucode/contracts";

import { ApiError, interpolate, type Translate } from "./error";

export type FetchLike = typeof fetch;

export type TransportOptions = {
  /** 服务根地址；缺省同源（空串），桌面端传 http://127.0.0.1:<port> */
  baseUrl?: string;
  /** 注入的 fetch；缺省用全局 fetch */
  fetch?: FetchLike;
  /** 附加到每个请求的头 */
  headers?: Record<string, string>;
  /** 鉴权令牌读取器；预留给后续的接口鉴权 */
  getToken?: () => string | Promise<string | null>;
  /** 错误兜底文案的翻译函数；未注入时用中文模板插值 */
  translate?: Translate;
};

export type Transport = {
  /** POST JSON 并拆封套 */
  post: <T>(action: string, body?: unknown) => Promise<T>;
  /** POST 原始字节（附件上传），响应仍走 JSON 封套 */
  postBinary: <T>(action: string, body: Blob, query?: Record<string, string>) => Promise<T>;
  /** POST 并返回流（事件流），不解析封套 */
  postStream: (
    action: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  /** GET 并拆封套 */
  get: <T>(action: string) => Promise<T>;
  /** 拼接绝对（或同源相对）地址，用于附件等直链 */
  absoluteUrl: (action: string) => string;
};

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

    throw new ApiError(
      record?.code ?? "unknown_error",
      record?.message ??
        message("请求失败（HTTP {{status}}）", { status: String(response.status) }),
      { details: record?.data, params: record?.params, httpStatus: response.status },
    );
  };

  /** 读取失败响应体里的原因，拿不到就退回状态码 */
  const readStreamError = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) return body.message;
    } catch {
      // 非 JSON，退回状态码
    }
    return message("事件流连接失败（HTTP {{status}}）", { status: String(response.status) });
  };

  return {
    async post<T>(action: string, body: unknown = {}): Promise<T> {
      const response = await doFetch(`${base}/${action}`, {
        method: "POST",
        headers: await requestHeaders("application/json"),
        body: JSON.stringify(body),
      });
      return unwrap<T>(response);
    },
    async postBinary<T>(action: string, body: Blob, query?: Record<string, string>): Promise<T> {
      const search = query ? `?${new URLSearchParams(query).toString()}` : "";
      const response = await doFetch(`${base}/${action}${search}`, {
        method: "POST",
        headers: await requestHeaders(body.type || "application/octet-stream"),
        body,
      });
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
        throw new ApiError("events_failed", await readStreamError(response), {
          httpStatus: response.status,
        });
      }
      if (!response.body) {
        throw new ApiError("events_failed", message("服务未返回流"));
      }
      return response.body;
    },
    async get<T>(action: string): Promise<T> {
      const response = await doFetch(`${base}/${action}`, { headers: await requestHeaders() });
      return unwrap<T>(response);
    },
    absoluteUrl: (action) => `${base}/${action}`,
  };
};
