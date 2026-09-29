/** /api/v1 的接口封装与统一错误类型 */
import {
  API_BASE_PATH,
  type ApiResponse,
  type AppConfigPatchRequest,
  type ConfigSnapshot,
  type ConfigTestRequest,
  type ConfigTestResponse,
  type HealthResponse,
  type MessageInterruptResponse,
  type MessageListRequest,
  type MessageListResponse,
  type ModelsResponse,
  type PromptAdmittedResponse,
  type PromptRequest,
  type ServerEvent,
  type SessionCreateRequest,
  type SessionDeleteResponse,
  type SessionIdRequest,
  type SessionInfoResponse,
  type SessionListRequest,
  type SessionListResponse,
  type SessionSummary,
  type SessionUpdateRequest,
} from "@ucode/contracts";

import { readSseStream } from "./sse";

const BASE = API_BASE_PATH;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
  }
}

/** 拆封套：success 为真返回 data，否则抛 ApiRequestError；失败详情挂在 details 上 */
const unwrap = async <T>(response: Response): Promise<T> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError(
      "invalid_response",
      `服务返回了非 JSON 响应（HTTP ${response.status}）`,
    );
  }

  const record = payload as ApiResponse<T> | null;
  if (record?.success) return record.data;

  throw new ApiRequestError(
    record?.code ?? "unknown_error",
    record?.message ?? `请求失败（HTTP ${response.status}）`,
    record?.data,
  );
};

const post = async <T>(action: string, body: unknown = {}): Promise<T> => {
  const response = await fetch(`${BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(response);
};

/** 把接口异常转成可直接展示的文案 */
export const describeError = (error: unknown): string =>
  error instanceof ApiRequestError ? error.message : String(error);

/** 读取失败响应体里的原因，拿不到就退回状态码 */
const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // 非 JSON，退回状态码
  }
  return `事件流连接失败（HTTP ${response.status}）`;
};

export const api = {
  async health(): Promise<HealthResponse> {
    return unwrap<HealthResponse>(await fetch(`${BASE}/health`));
  },
  models: {
    list: () => post<ModelsResponse>("models/list"),
    refresh: () => post<ModelsResponse>("models/refresh"),
  },
  config: {
    info: () => post<ConfigSnapshot>("config/info"),
    update: (patch: AppConfigPatchRequest) => post<ConfigSnapshot>("config/update", patch),
    test: (input: ConfigTestRequest) => post<ConfigTestResponse>("config/test", input),
  },
  sessions: {
    list: (body: SessionListRequest) => post<SessionListResponse>("sessions/list", body),
    create: (body: SessionCreateRequest = {}) => post<SessionSummary>("sessions/create", body),
    info: (sessionId: string) =>
      post<SessionInfoResponse>("sessions/info", { sessionId } satisfies SessionIdRequest),
    update: (body: SessionUpdateRequest) => post<SessionSummary>("sessions/update", body),
    remove: (sessionId: string) =>
      post<SessionDeleteResponse>("sessions/delete", { sessionId } satisfies SessionIdRequest),
  },
  messages: {
    list: (sessionId: string) =>
      post<MessageListResponse>("messages/list", { sessionId } satisfies MessageListRequest),
    prompt: (body: PromptRequest) => post<PromptAdmittedResponse>("messages/prompt", body),
    interrupt: (sessionId: string) =>
      post<MessageInterruptResponse>("messages/interrupt", {
        sessionId,
      } satisfies SessionIdRequest),
  },
  events: {
    /** 订阅全局事件流；连接结束（含被 signal 中断）后返回 */
    subscribe: async (
      onEvent: (frame: ServerEvent) => void,
      signal: AbortSignal,
    ): Promise<void> => {
      const response = await fetch(`${BASE}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal,
      });

      if (!response.ok) {
        throw new ApiRequestError("events_failed", await readErrorMessage(response));
      }
      if (!response.body) {
        throw new ApiRequestError("events_failed", "服务未返回流");
      }

      await readSseStream(
        response.body,
        (_event, data) => {
          if (data && typeof data === "object") onEvent(data as ServerEvent);
        },
        signal,
      );
    },
  },
};
