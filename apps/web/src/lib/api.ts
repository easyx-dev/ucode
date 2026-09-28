/** /api/v1 的接口封装与统一错误类型 */
import { readSseStream } from "./sse";
import type {
  ApiType,
  ConfigView,
  HealthResponse,
  MessageDTO,
  ModelsResponse,
  RuntimeStatus,
  SessionSummary,
  ThinkingLevel,
} from "./types";

const BASE = "/api/v1";

export type ApiErrorBody = { code: string; message: string; details?: unknown };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

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

  const record = payload as { ok?: boolean; data?: T; error?: ApiErrorBody };
  if (record.ok === true) return record.data as T;

  throw new ApiRequestError(
    record.error?.code ?? "unknown_error",
    record.error?.message ?? `请求失败（HTTP ${response.status}）`,
    record.error?.details,
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

export type TestResult = { latencyMs: number; modelEcho: string | null; url: string };

export const api = {
  async health(): Promise<HealthResponse> {
    return unwrap<HealthResponse>(await fetch(`${BASE}/health`));
  },
  models: {
    list: () => post<ModelsResponse>("models/list"),
    refresh: () => post<ModelsResponse>("models/refresh"),
  },
  config: {
    info: () => post<{ config: ConfigView; status: RuntimeStatus }>("config/info"),
    update: (patch: unknown) =>
      post<{ config: ConfigView; status: RuntimeStatus }>("config/update", patch),
    test: (input: {
      baseUrl: string;
      apiKey?: string;
      providerId?: string;
      api?: ApiType;
      model: string;
    }) => post<TestResult>("config/test", input),
  },
  sessions: {
    list: (body: { q?: string; limit?: number } = {}) =>
      post<{ sessions: SessionSummary[]; total: number }>("sessions/list", body),
    create: (
      body: { name?: string; cwd?: string; model?: string; thinkingLevel?: ThinkingLevel } = {},
    ) => post<SessionSummary>("sessions/create", body),
    info: (sessionId: string) =>
      post<{ session: SessionSummary; persisted: boolean; entries: number }>("sessions/info", {
        sessionId,
      }),
    update: (body: {
      sessionId: string;
      name?: string;
      model?: string;
      thinkingLevel?: ThinkingLevel;
    }) => post<SessionSummary>("sessions/update", body),
    remove: (sessionId: string) => post<{ deleted: boolean }>("sessions/delete", { sessionId }),
  },
  messages: {
    list: (sessionId: string) =>
      post<{ sessionId: string; messages: MessageDTO[]; persisted: boolean; cwd: string }>(
        "messages/list",
        {
          sessionId,
        },
      ),
    interrupt: (sessionId: string) =>
      post<{ sessionId: string; aborted: boolean }>("messages/interrupt", { sessionId }),
  },
};

export const sendMessageUrl = `${BASE}/messages/send`;

/** 读取失败响应体里的原因，拿不到就退回状态码 */
const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // 非 JSON，退回状态码
  }
  return `发送失败（HTTP ${response.status}）`;
};

/** 发送消息并消费 SSE 流；开跑前的失败（未配置模型等）以异常抛出 */
export const sendMessageStream = async (
  sessionId: string,
  text: string,
  onEvent: (event: string, payload: unknown) => void,
  signal: AbortSignal,
): Promise<void> => {
  const response = await fetch(sendMessageUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text }),
    signal,
  });

  if (!response.ok) {
    throw new ApiRequestError("send_failed", await readErrorMessage(response));
  }
  if (!response.body) {
    throw new ApiRequestError("send_failed", "服务未返回流");
  }

  await readSseStream(response.body, onEvent, signal);
};
