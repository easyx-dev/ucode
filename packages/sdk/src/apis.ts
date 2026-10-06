/** 接口层：按域组装 /api/v1 的调用方法，直接复用 @ucode/contracts 的请求 / 响应类型 */
import type {
  AgentsListRequest,
  AgentsListResponse,
  AppConfigPatchRequest,
  AttachmentUploadResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthLogoutResponse,
  AuthPasswordRequest,
  AuthPasswordResponse,
  AuthSessionListResponse,
  AuthSessionRevokeResponse,
  CommandsListRequest,
  CommandsListResponse,
  ConfigSnapshot,
  ConfigTestRequest,
  ConfigTestResponse,
  FsListRequest,
  FsListResponse,
  FsMkdirRequest,
  FsMkdirResponse,
  FsSearchRequest,
  FsSearchResponse,
  GoalResponse,
  GoalSetRequest,
  InteractionListResponse,
  InteractionRespondRequest,
  InteractionRespondResponse,
  McpDeleteResponse,
  McpListResponse,
  McpUpsertRequest,
  McpWriteResponse,
  MessageCompactRequest,
  MessageEditRequest,
  MessageIgnorePlanResponse,
  MessageInterruptResponse,
  MessageListRequest,
  MessageListResponse,
  ModelsResponse,
  PairingCreateOutput,
  PromptAdmittedResponse,
  PromptRequest,
  ServerEvent,
  ServerInfoResponse,
  ServiceHostRequest,
  ServiceHostResponse,
  ServiceInfoResponse,
  SessionArchiveResponse,
  SessionCreateRequest,
  SessionForkRequest,
  SessionIdRequest,
  SessionInfoResponse,
  SessionListRequest,
  SessionListResponse,
  SessionSummary,
  SessionUpdateRequest,
  StatsSummaryRequest,
  StatsSummaryResponse,
  StatusResponse,
  WhoamiResponse,
} from "@ucode/contracts";

import { readSseStream } from "./sse";
import { createTransport, type TransportOptions } from "./transport";

export type ApisOptions = TransportOptions;

/**
 * 无状态接口层：一条方法对应一个接口，不做任何缓存与事件归并。
 * 需要「与 server 同步的状态」时用 `createClient`（在其上装配 events 与各域 store）。
 */
export const createApis = (options: ApisOptions = {}) => {
  const transport = createTransport(options);

  return {
    /** 附属资源直链（图片预览等）；baseUrl 为空时返回同源相对地址 */
    attachmentUrl: (id: string): string => transport.absoluteUrl(`attachments/${id}`),

    /** 服务发现与版本兼容（未认证） */
    async info(): Promise<ServerInfoResponse> {
      return transport.get<ServerInfoResponse>("info");
    },
    /** 认证后的运行时状态（替代原 health 富载荷） */
    async status(): Promise<StatusResponse> {
      return transport.get<StatusResponse>("status");
    },
    auth: {
      login: (body: AuthLoginRequest) => transport.post<AuthLoginResponse>("auth/login", body),
      logout: () => transport.post<AuthLogoutResponse>("auth/logout", {}),
      session: () => transport.get<WhoamiResponse>("auth/session"),
      sessions: () => transport.get<AuthSessionListResponse>("auth/sessions"),
      revokeSession: (sessionId: string) =>
        transport.post<AuthSessionRevokeResponse>("auth/sessions/revoke", {
          authSessionId: sessionId,
        }),
      changePassword: (body: AuthPasswordRequest) =>
        transport.post<AuthPasswordResponse>("auth/password", body),
      createPairing: () => transport.post<PairingCreateOutput>("auth/pairing/create", {}),
    },
    service: {
      info: () => transport.get<ServiceInfoResponse>("service/info"),
      setHost: (host: ServiceHostRequest["host"]) =>
        transport.post<ServiceHostResponse>("service/host", { host }),
    },
    models: {
      list: () => transport.post<ModelsResponse>("models/list"),
      refresh: () => transport.post<ModelsResponse>("models/refresh"),
    },
    config: {
      info: () => transport.post<ConfigSnapshot>("config/info"),
      update: (patch: AppConfigPatchRequest) =>
        transport.post<ConfigSnapshot>("config/update", patch),
      test: (input: ConfigTestRequest) => transport.post<ConfigTestResponse>("config/test", input),
    },
    sessions: {
      list: (body: SessionListRequest) =>
        transport.post<SessionListResponse>("sessions/list", body),
      create: (body: SessionCreateRequest = {}) =>
        transport.post<SessionSummary>("sessions/create", body),
      info: (sessionId: string) =>
        transport.post<SessionInfoResponse>("sessions/info", {
          sessionId,
        } satisfies SessionIdRequest),
      update: (body: SessionUpdateRequest) =>
        transport.post<SessionSummary>("sessions/update", body),
      read: (sessionId: string) =>
        transport.post<SessionSummary>("sessions/read", {
          sessionId,
        } satisfies SessionIdRequest),
      fork: (body: SessionForkRequest) => transport.post<SessionSummary>("sessions/fork", body),
      archive: (sessionId: string) =>
        transport.post<SessionArchiveResponse>("sessions/archive", {
          sessionId,
        } satisfies SessionIdRequest),
    },
    stats: {
      /** 全局使用统计；`days` 缺省为全部时间 */
      summary: (body: StatsSummaryRequest = {}) =>
        transport.post<StatsSummaryResponse>("stats/summary", body),
    },
    goals: {
      /** 设定 / 替换当前会话目标；由服务端起第一轮 */
      set: (body: GoalSetRequest) => transport.post<GoalResponse>("goals/set", body),
      status: (sessionId: string) =>
        transport.post<GoalResponse>("goals/status", { sessionId } satisfies SessionIdRequest),
      pause: (sessionId: string) =>
        transport.post<GoalResponse>("goals/pause", { sessionId } satisfies SessionIdRequest),
      resume: (sessionId: string) =>
        transport.post<GoalResponse>("goals/resume", { sessionId } satisfies SessionIdRequest),
      clear: (sessionId: string) =>
        transport.post<GoalResponse>("goals/clear", { sessionId } satisfies SessionIdRequest),
    },
    interactions: {
      /** 补齐某会话尚未回答的交互请求（刷新 / 重连后） */
      list: (sessionId: string) =>
        transport.post<InteractionListResponse>("interactions/list", { sessionId }),
      respond: (body: InteractionRespondRequest) =>
        transport.post<InteractionRespondResponse>("interactions/respond", body),
    },
    fs: {
      list: (body: FsListRequest = {}) => transport.post<FsListResponse>("fs/list", body),
      search: (body: FsSearchRequest = {}) => transport.post<FsSearchResponse>("fs/search", body),
      mkdir: (path: string) =>
        transport.post<FsMkdirResponse>("fs/mkdir", { path } satisfies FsMkdirRequest),
    },
    commands: {
      /** 列出可用的提示词命令与技能（按会话 / cwd 解析目录） */
      list: (body: CommandsListRequest = {}) =>
        transport.post<CommandsListResponse>("commands/list", body),
    },
    attachments: {
      /** 上传附件：body 为原始字节，`name` 走查询串；返回入库后的引用视图 */
      upload: (file: Blob, name?: string) =>
        transport.postBinary<AttachmentUploadResponse>(
          "attachments",
          file,
          name ? { name } : undefined,
        ),
    },
    agents: {
      /** 列出可选的 primary / subagent 角色 */
      list: (body: AgentsListRequest = {}) =>
        transport.post<AgentsListResponse>("agents/list", body),
    },
    mcp: {
      list: () => transport.post<McpListResponse>("mcp/list"),
      upsert: (body: McpUpsertRequest) => transport.post<McpWriteResponse>("mcp/upsert", body),
      remove: (name: string) => transport.post<McpDeleteResponse>("mcp/delete", { name }),
    },
    messages: {
      list: (sessionId: string) =>
        transport.post<MessageListResponse>("messages/list", {
          sessionId,
        } satisfies MessageListRequest),
      prompt: (body: PromptRequest) =>
        transport.post<PromptAdmittedResponse>("messages/prompt", body),
      /** 编辑一条用户消息并重发；旧分支保留，客户端靠 transcript_reset 事件刷新 */
      edit: (body: MessageEditRequest) =>
        transport.post<PromptAdmittedResponse>("messages/edit", body),
      interrupt: (sessionId: string) =>
        transport.post<MessageInterruptResponse>("messages/interrupt", {
          sessionId,
        } satisfies SessionIdRequest),
      /** 手动压缩上下文；进度走 compaction_* 事件 */
      compact: (body: MessageCompactRequest) =>
        transport.post<PromptAdmittedResponse>("messages/compact", body),
      /** 忽略本次计划的决策表单；刷新由 transcript_reset 事件驱动 */
      ignorePlan: (sessionId: string) =>
        transport.post<MessageIgnorePlanResponse>("messages/ignore-plan", {
          sessionId,
        } satisfies SessionIdRequest),
    },
    events: {
      /** 建立全局事件流连接；连接结束（含被 signal 中断）后返回 */
      stream: async (onEvent: (frame: ServerEvent) => void, signal: AbortSignal): Promise<void> => {
        const body = await transport.postStream("events", {}, signal);
        await readSseStream(
          body,
          (_event, data) => {
            if (data && typeof data === "object") onEvent(data as ServerEvent);
          },
          signal,
        );
      },
    },
  };
};

export type Apis = ReturnType<typeof createApis>;
