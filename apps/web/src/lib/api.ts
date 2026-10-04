/** /api/v1 的接口封装与统一错误类型 */
import {
  type AgentsListRequest,
  type AgentsListResponse,
  API_BASE_PATH,
  type ApiResponse,
  type AppConfigPatchRequest,
  type AttachmentUploadResponse,
  type CommandsListRequest,
  type CommandsListResponse,
  type ConfigSnapshot,
  type ConfigTestRequest,
  type ConfigTestResponse,
  type FsListRequest,
  type FsListResponse,
  type FsMkdirRequest,
  type FsMkdirResponse,
  type FsSearchRequest,
  type FsSearchResponse,
  type GoalResponse,
  type GoalSetRequest,
  type HealthResponse,
  type InteractionListResponse,
  type InteractionRespondRequest,
  type InteractionRespondResponse,
  type McpDeleteResponse,
  type McpListResponse,
  type McpUpsertRequest,
  type McpWriteResponse,
  type MessageCompactRequest,
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
  type StatsSummaryRequest,
  type StatsSummaryResponse,
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
      i18n.t("服务返回了非 JSON 响应（HTTP {{status}}）", { status: response.status }),
    );
  }

  const record = payload as ApiResponse<T> | null;
  if (record?.success) return record.data;

  throw new ApiRequestError(
    record?.code ?? "unknown_error",
    record?.message ?? i18n.t("请求失败（HTTP {{status}}）", { status: response.status }),
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

/** 二进制请求体的 POST：body 是原始字节（附件上传），响应仍走 JSON 封套 */
const postBinary = async <T>(
  action: string,
  body: Blob,
  query?: Record<string, string>,
): Promise<T> => {
  const search = query ? `?${new URLSearchParams(query).toString()}` : "";
  const response = await fetch(`${BASE}/${action}${search}`, {
    method: "POST",
    headers: { "content-type": body.type || "application/octet-stream" },
    body,
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
  return i18n.t("事件流连接失败（HTTP {{status}}）", { status: response.status });
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
  stats: {
    /** 全局使用统计；`days` 缺省为全部时间 */
    summary: (body: StatsSummaryRequest = {}) => post<StatsSummaryResponse>("stats/summary", body),
  },
  goals: {
    /** 设定 / 替换当前会话目标；由服务端起第一轮 */
    set: (body: GoalSetRequest) => post<GoalResponse>("goals/set", body),
    status: (sessionId: string) =>
      post<GoalResponse>("goals/status", { sessionId } satisfies SessionIdRequest),
    pause: (sessionId: string) =>
      post<GoalResponse>("goals/pause", { sessionId } satisfies SessionIdRequest),
    resume: (sessionId: string) =>
      post<GoalResponse>("goals/resume", { sessionId } satisfies SessionIdRequest),
    clear: (sessionId: string) =>
      post<GoalResponse>("goals/clear", { sessionId } satisfies SessionIdRequest),
  },
  interactions: {
    /** 补齐某会话尚未回答的交互请求（刷新 / 重连后） */
    list: (sessionId: string) => post<InteractionListResponse>("interactions/list", { sessionId }),
    respond: (body: InteractionRespondRequest) =>
      post<InteractionRespondResponse>("interactions/respond", body),
  },
  fs: {
    list: (body: FsListRequest = {}) => post<FsListResponse>("fs/list", body),
    search: (body: FsSearchRequest = {}) => post<FsSearchResponse>("fs/search", body),
    mkdir: (path: string) => post<FsMkdirResponse>("fs/mkdir", { path } satisfies FsMkdirRequest),
  },
  commands: {
    /** 列出可用的提示词命令与技能（按会话 / cwd 解析目录） */
    list: (body: CommandsListRequest = {}) => post<CommandsListResponse>("commands/list", body),
  },
  attachments: {
    /** 上传附件：body 为原始字节，`name` 走查询串；返回入库后的引用视图 */
    upload: (file: Blob, name?: string) =>
      postBinary<AttachmentUploadResponse>("attachments", file, name ? { name } : undefined),
  },
  agents: {
    /** 列出可选的 primary / subagent 角色 */
    list: (body: AgentsListRequest = {}) => post<AgentsListResponse>("agents/list", body),
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
    /** 手动压缩上下文；进度走 compaction_* 事件 */
    compact: (body: MessageCompactRequest) =>
      post<PromptAdmittedResponse>("messages/compact", body),
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
