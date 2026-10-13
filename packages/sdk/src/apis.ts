/** 接口层：按域组装 /api/v1 的调用方法，直接复用 @ucode/contracts 的请求 / 响应类型 */
import type {
  AgentsListRequest,
  AgentsListResponse,
  AppConfigPatchRequest,
  AttachmentUploadResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthLogoutResponse,
  AuthPairingRedeemResponse,
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
  FsReadRequest,
  FsReadResponse,
  FsSearchRequest,
  FsSearchResponse,
  GitContentsRequest,
  GitContentsResponse,
  GitDiffRequest,
  GitDiffResponse,
  GitLogRequest,
  GitLogResponse,
  GitShowRequest,
  GitShowResponse,
  GitStatusRequest,
  GitStatusResponse,
  GoalBudgetRequest,
  GoalResponse,
  GoalSetRequest,
  InteractionListResponse,
  InteractionRespondRequest,
  InteractionRespondResponse,
  MarketplaceCreateRequest,
  MarketplaceDeleteResponse,
  MarketplacePluginsResponse,
  MarketplacesListResponse,
  MarketplaceWriteResponse,
  McpDeleteResponse,
  McpListResponse,
  McpUpsertRequest,
  McpWriteResponse,
  MessageApprovePlanResponse,
  MessageCompactRequest,
  MessageEditRequest,
  MessageIgnorePlanResponse,
  MessageInterruptResponse,
  MessageListRequest,
  MessageListResponse,
  MessageServicesRequest,
  MessageServicesResponse,
  ModelsResponse,
  PairingCreateOutput,
  PluginCreateRequest,
  PluginDeleteRequest,
  PluginDeleteResponse,
  PluginListRequest,
  PluginRefreshRequest,
  PluginsListResponse,
  PluginUpdateRequest,
  PluginWriteResponse,
  ProjectListResponse,
  ProjectReorderRequest,
  ProjectSummary,
  ProjectUpdateRequest,
  PromptAdmittedResponse,
  PromptRequest,
  ProviderModelsRequest,
  ProviderModelsResponse,
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
  SessionTranscriptResponse,
  SessionUpdateRequest,
  StatsSummaryRequest,
  StatsSummaryResponse,
  StatusResponse,
  WhoamiResponse,
} from "@ucode/contracts";

import { readSseStream } from "./sse";
import { createTransport, type TransportOptions } from "./transport";

export type ApisOptions = TransportOptions & {
  /**
   * 会话 token 的落点：登录 / 配对兑换成功时给出明文 token，登出、改密码与凭证失效时给 `null`。
   * 存储形式由宿主决定（浏览器落 localStorage；原生端不设——它用 `serviceToken`）。
   */
  onToken?: (token: string | null) => void;
};

/**
 * 无状态接口层：一条方法对应一个接口，不做任何缓存与事件归并。
 * 需要「与 server 同步的状态」时用 `createClient`（在其上装配 events 与各域 store）。
 */
export const createApis = (options: ApisOptions = {}) => {
  const transport = createTransport({
    ...options,
    // 「凭证失效就清掉 token」在这一处收口，不必让每个调用方自己记着清
    onUnauthorized: () => {
      options.onToken?.(null);
      options.onUnauthorized?.();
    },
  });

  return {
    /** 服务发现与版本兼容（未认证） */
    async info(): Promise<ServerInfoResponse> {
      return transport.get<ServerInfoResponse>("info");
    },
    /** 认证后的运行时状态（替代原 health 富载荷） */
    async status(): Promise<StatusResponse> {
      return transport.get<StatusResponse>("status");
    },
    auth: {
      /** 密码登录；成功后把会话 token 交给宿主保存 */
      async login(body: AuthLoginRequest) {
        const result = await transport.post<AuthLoginResponse>("auth/login", body);
        options.onToken?.(result.token);
        return result;
      },
      async logout() {
        const result = await transport.post<AuthLogoutResponse>("auth/logout", {});
        options.onToken?.(null);
        return result;
      },
      session: () => transport.get<WhoamiResponse>("auth/session"),
      sessions: () => transport.get<AuthSessionListResponse>("auth/sessions"),
      revokeSession: (sessionId: string) =>
        transport.post<AuthSessionRevokeResponse>("auth/sessions/revoke", {
          authSessionId: sessionId,
        }),
      /** 改密码撤销全部会话（含本端），token 随即失效 */
      async changePassword(body: AuthPasswordRequest) {
        const result = await transport.post<AuthPasswordResponse>("auth/password", body);
        options.onToken?.(null);
        return result;
      },
      createPairing: () => transport.post<PairingCreateOutput>("auth/pairing/create", {}),
      /** 兑换一次性配对码；成功后同样把 token 交给宿主保存 */
      async redeemPairing(code: string) {
        const result = await transport.post<AuthPairingRedeemResponse>("auth/pairing/redeem", {
          code,
        });
        options.onToken?.(result.token);
        return result;
      },
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
      fetchModels: (input: ProviderModelsRequest) =>
        transport.post<ProviderModelsResponse>("config/fetch-models", input, {
          // 这条要走去上游拉模型目录，慢是正常的
          timeoutMs: 60_000,
        }),
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
      /** 会话原始记录（JSONL 文本）：给「复制 JSONL 内容」这类导出用 */
      transcript: (sessionId: string) =>
        transport.post<SessionTranscriptResponse>("sessions/transcript", {
          sessionId,
        } satisfies SessionIdRequest),
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
    projects: {
      /** 项目列表：按 cwd 归口的展示名与最近一次选择的会话参数；次序就是侧栏里的次序 */
      list: () => transport.post<ProjectListResponse>("projects/list", {}),
      /** 重命名项目；`name` 传 null 即清空 */
      update: (body: ProjectUpdateRequest) =>
        transport.post<ProjectSummary>("projects/update", body),
      /** 重排项目：`paths` 是侧栏里从上到下的目录次序 */
      reorder: (body: ProjectReorderRequest) =>
        transport.post<ProjectListResponse>("projects/reorder", body),
    },
    goals: {
      /** 设定 / 替换当前会话目标；由服务端起第一轮 */
      set: (body: GoalSetRequest) => transport.post<GoalResponse>("goals/set", body),
      /** 只改目标预算（patch 语义）；`tokenBudget` 传 null 即取消上限 */
      budget: (body: GoalBudgetRequest) => transport.post<GoalResponse>("goals/budget", body),
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
      /** 读单个文件内容（预览器用）；`maxBytes` 是愿意接收的内联体积 */
      read: (body: FsReadRequest) => transport.post<FsReadResponse>("fs/read", body),
    },
    git: {
      /** 仓库状态与分组的变更列表；不在仓库内时 `isRepo` 为 false */
      status: (body: GitStatusRequest) => transport.post<GitStatusResponse>("git/status", body),
      /** 单文件 diff；`source` 选工作区 / index / 某次提交 */
      diff: (body: GitDiffRequest) => transport.post<GitDiffResponse>("git/diff", body),
      log: (body: GitLogRequest) => transport.post<GitLogResponse>("git/log", body),
      /** 同一个文件对比两侧的原文（展开未变更区域用）；参数与 `diff` 同义 */
      contents: (body: GitContentsRequest) =>
        transport.post<GitContentsResponse>("git/contents", body),
      show: (body: GitShowRequest) => transport.post<GitShowResponse>("git/show", body),
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
          // 附件可达 32MB，别按普通接口的 30s 卡它
          { timeoutMs: 120_000 },
        ),
      /** 取附件字节：浏览器没法给 `<img src>` 附凭证，故由客户端取回再转 blob URL */
      download: (id: string) =>
        // 与上传对称：附件可达 32MB，别按普通接口的 30s 卡它
        transport.getBlob(`attachments/${id}`, { timeoutMs: 120_000 }),
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
    plugins: {
      list: (body: PluginListRequest = {}) =>
        transport.post<PluginsListResponse>("plugins/list", body),
      create: (body: PluginCreateRequest) =>
        transport.post<PluginWriteResponse>("plugins/create", body),
      update: (body: PluginUpdateRequest) =>
        transport.post<PluginWriteResponse>("plugins/update", body),
      remove: (body: PluginDeleteRequest) =>
        transport.post<PluginDeleteResponse>("plugins/delete", body),
      refresh: (id: string) =>
        transport.post<PluginWriteResponse>("plugins/refresh", {
          id,
        } satisfies PluginRefreshRequest),
    },
    marketplace: {
      list: () => transport.post<MarketplacesListResponse>("marketplace/list"),
      info: (name: string) =>
        transport.post<MarketplacePluginsResponse>("marketplace/info", { name }),
      create: (body: MarketplaceCreateRequest) =>
        transport.post<MarketplaceWriteResponse>("marketplace/create", body),
      remove: (name: string) =>
        transport.post<MarketplaceDeleteResponse>("marketplace/delete", { name }),
      refresh: (name: string) =>
        transport.post<MarketplaceWriteResponse>("marketplace/refresh", { name }),
    },
    messages: {
      list: (sessionId: string) =>
        transport.post<MessageListResponse>("messages/list", {
          sessionId,
        } satisfies MessageListRequest),
      /** 后台服务清单的单独读取；比 `list` 轻得多，活动面板打开时用它 */
      services: (sessionId: string) =>
        transport.post<MessageServicesResponse>("messages/services", {
          sessionId,
        } satisfies MessageServicesRequest),
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
      /**
       * 批准计划：服务端注入「已批准」的合成输入并起一轮；模式由调用方先经
       * `sessions/update` 切回 build（那里才是模式的校验与生效点）
       */
      approvePlan: (sessionId: string) =>
        transport.post<MessageApprovePlanResponse>("messages/approve-plan", {
          sessionId,
        } satisfies SessionIdRequest),
    },
    events: {
      /** 建立全局事件流连接；连接结束（含被 signal 中断）后返回 */
      stream: async (
        onEvent: (frame: ServerEvent) => void,
        signal: AbortSignal,
        onActivity: () => void,
      ): Promise<void> => {
        const body = await transport.postStream("events", {}, signal);
        await readSseStream(
          body,
          (_event, data) => {
            if (data && typeof data === "object") onEvent(data as ServerEvent);
          },
          signal,
          onActivity,
        );
      },
    },
  };
};

export type Apis = ReturnType<typeof createApis>;
