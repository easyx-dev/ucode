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
    throw new ApiRequestError("invalid_response", `服务返回了非 JSON 响应（HTTP ${response.status}）`);
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
    update: (patch: unknown) => post<{ config: ConfigView; status: RuntimeStatus }>("config/update", patch),
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
    create: (body: { name?: string; cwd?: string; model?: string; thinkingLevel?: ThinkingLevel } = {}) =>
      post<SessionSummary>("sessions/create", body),
    info: (sessionId: string) =>
      post<{ session: SessionSummary; persisted: boolean; entries: number }>("sessions/info", { sessionId }),
    update: (body: { sessionId: string; name?: string; model?: string; thinkingLevel?: ThinkingLevel }) =>
      post<SessionSummary>("sessions/update", body),
    remove: (sessionId: string) => post<{ deleted: boolean }>("sessions/delete", { sessionId }),
  },
  messages: {
    list: (sessionId: string) =>
      post<{ sessionId: string; messages: MessageDTO[]; persisted: boolean; cwd: string }>("messages/list", {
        sessionId,
      }),
    interrupt: (sessionId: string) =>
      post<{ sessionId: string; aborted: boolean }>("messages/interrupt", { sessionId }),
  },
};

export const sendMessageUrl = `${BASE}/messages/send`;
