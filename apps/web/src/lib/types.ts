/** web 侧类型出口：契约类型统一来自 @ucode/contracts，ChatItem 是界面状态 */
import type { MessageDTO } from "@ucode/contracts";

export type {
  AgentsListResponse,
  AgentView,
  ApiType,
  CatalogModel,
  CatalogProvider,
  CommandAssetSource,
  CommandsListResponse,
  ConfigSnapshot,
  ConfigTestResponse,
  ConfigView,
  ContextRef,
  EventName,
  FsEntry,
  FsListRequest,
  FsListResponse,
  FsSearchResponse,
  GoalPauseCause,
  GoalResponse,
  GoalSetRequest,
  GoalStatus,
  GoalView,
  HealthResponse,
  InteractionRespondRequest,
  McpExposure,
  McpListResponse,
  McpServerView,
  McpTransport,
  MemoryView,
  MessageBlock,
  MessageCompactRequest,
  MessageDTO,
  MessageEditRequest,
  MessageImage,
  MessageRole,
  ModelsResponse,
  ModelUsage,
  PendingInteraction,
  PermissionDecision,
  PermissionInteraction,
  PromptAdmittedResponse,
  PromptCommandView,
  PromptRequest,
  ProviderConfigView,
  ProviderModelView,
  QuestionInteraction,
  QuestionItem,
  QuestionOption,
  RuntimeStatus,
  SearchProviderId,
  ServerEvent,
  ServerEventPayload,
  SessionCreateRequest,
  SessionListResponse,
  SessionMode,
  SessionSummary,
  SessionUsageEntry,
  SessionUsageKind,
  SkillCommandView,
  StatsSummaryResponse,
  ThinkingLevel,
  UsageTotals,
  WebsearchView,
} from "@ucode/contracts";
export {
  API_TYPES,
  DEFAULT_MCP_EXPOSURE,
  DEFAULT_SEARCH_PROVIDER,
  GOAL_PAUSE_CAUSES,
  GOAL_STATUSES,
  KEYLESS_SEARCH_PROVIDERS,
  MCP_EXPOSURES,
  MCP_TRANSPORTS,
  SEARCH_PROVIDER_LABELS,
  SEARCH_PROVIDERS,
  SESSION_MODES,
  THINKING_LEVELS,
} from "@ucode/contracts";

/** 界面上的一条消息：live 表示还在流式生成中 */
export type ChatItem = MessageDTO & { live?: boolean };

/**
 * 一次子智能体委派在界面上的进度：`toolCallId` 为键，嵌套内容是子会话自己的消息。
 * 进度不落盘，刷新后不重建，只作实时展示。
 */
export type SubagentStream = {
  /** 子会话 id；据此可从卡片直接打开该子会话 */
  sessionId: string;
  /** 任务简称，服务端已按长度截断；用于嵌套卡标题 */
  description: string;
  /** 子会话的消息列表（按事件流实时归并） */
  items: ChatItem[];
  /** 是否已结束（收到 `subagent_end` 或父会话落定） */
  done: boolean;
  isError: boolean;
};

/** 按父会话里的 `toolCallId` 索引的进行中子智能体 */
export type SubagentStreams = Record<string, SubagentStream>;
