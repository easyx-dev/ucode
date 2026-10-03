/** /api/v1 的接口封装与统一错误类型 */
import {
  API_BASE_PATH,
  type ApiResponse,
  type AppConfigPatchRequest,
  type ConfigSnapshot,
  type ConfigTestRequest,
  type ConfigTestResponse,
  type FsListRequest,
  type FsListResponse,
  type FsMkdirRequest,
  type FsMkdirResponse,
  type HealthResponse,
  type InteractionListResponse,
  type InteractionRespondRequest,
  type InteractionRespondResponse,
  type McpDeleteResponse,
  type McpListResponse,
  type McpUpsertRequest,
  type McpWriteResponse,
  type MessageEditRequest,
  type MessageInterruptResponse,
  type MessageListRequest,
  type MessageListResponse,
  type ModelsResponse,
  type PromptAdmittedResponse,
  type PromptRequest,
  type ServerEvent,
  type SessionArchiveResponse,
  type SessionCreateRequest,
  type SessionForkRequest,
  type SessionIdRequest,
  type SessionInfoResponse,
  type SessionListRequest,
  type SessionListResponse,
  type SessionSummary,
  type SessionUpdateRequest,
} from "@ucode/contracts";
import { errorMessageKey } from "@ucode/i18n";

import i18n from "./i18n";
import { readSseStream } from "./sse";

const BASE = API_BASE_PATH;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: unknown;
  /** 渲染该错误码文案所需的插值值 */
  readonly params?: Record<string, string>;

  constructor(code: string, message: string, details?: unknown, params?: Record<string, string>) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
    this.params = params;
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
      i18n.t("响应.非JSON", { status: response.status }),
    );
  }

  const record = payload as ApiResponse<T> | null;
  if (record?.success) return record.data;

  throw new ApiRequestError(
    record?.code ?? "unknown_error",
    record?.message ?? i18n.t("请求失败", { status: response.status }),
    record?.data,
    record?.params,
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

/** 按错误码取当前语言的文案；未登记的错误码回落服务端下发的中文兜底 */
export const describeApiError = (
  code: string,
  message: string,
  params?: Record<string, string>,
): string => {
  const key = errorMessageKey(code);
  return key ? i18n.t(key, params) : message;
};

/** 把接口异常转成可直接展示的文案 */
export const describeError = (error: unknown): string =>
  error instanceof ApiRequestError
    ? describeApiError(error.code, error.message, error.params)
    : String(error);

/** 读取失败响应体里的原因，拿不到就退回状态码 */
const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // 非 JSON，退回状态码
  }
  return i18n.t("事件流失败", { status: response.status });
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
    fork: (body: SessionForkRequest) => post<SessionSummary>("sessions/fork", body),
    archive: (sessionId: string) =>
      post<SessionArchiveResponse>("sessions/archive", { sessionId } satisfies SessionIdRequest),
  },
  interactions: {
    /** 补齐某会话尚未回答的交互请求（刷新 / 重连后） */
    list: (sessionId: string) => post<InteractionListResponse>("interactions/list", { sessionId }),
    respond: (body: InteractionRespondRequest) =>
      post<InteractionRespondResponse>("interactions/respond", body),
  },
  fs: {
    list: (body: FsListRequest = {}) => post<FsListResponse>("fs/list", body),
    mkdir: (path: string) => post<FsMkdirResponse>("fs/mkdir", { path } satisfies FsMkdirRequest),
  },
  mcp: {
    list: () => post<McpListResponse>("mcp/list"),
    upsert: (body: McpUpsertRequest) => post<McpWriteResponse>("mcp/upsert", body),
    remove: (name: string) => post<McpDeleteResponse>("mcp/delete", { name }),
  },
  messages: {
    list: (sessionId: string) =>
      post<MessageListResponse>("messages/list", { sessionId } satisfies MessageListRequest),
    prompt: (body: PromptRequest) => post<PromptAdmittedResponse>("messages/prompt", body),
    /** 编辑一条用户消息并重发；旧分支保留，客户端靠 transcript_reset 事件刷新 */
    edit: (body: MessageEditRequest) => post<PromptAdmittedResponse>("messages/edit", body),
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
        throw new ApiRequestError("events_failed", i18n.t("服务未返回流"));
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
