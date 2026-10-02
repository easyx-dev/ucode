/** web 侧类型出口：契约类型统一来自 @ucode/contracts，ChatItem 是界面状态 */
import type { MessageDTO } from "@ucode/contracts";

export type {
  ApiType,
  CatalogModel,
  CatalogProvider,
  ConfigSnapshot,
  ConfigTestResponse,
  ConfigView,
  EventName,
  FsEntry,
  FsListRequest,
  FsListResponse,
  HealthResponse,
  InteractionRespondRequest,
  MemoryView,
  MessageBlock,
  MessageDTO,
  MessageRole,
  ModelsResponse,
  PendingInteraction,
  PermissionDecision,
  PermissionInteraction,
  PromptAdmittedResponse,
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
  ThinkingLevel,
  WebsearchView,
} from "@ucode/contracts";
export {
  API_TYPES,
  DEFAULT_SEARCH_PROVIDER,
  KEYLESS_SEARCH_PROVIDERS,
  SEARCH_PROVIDER_LABELS,
  SEARCH_PROVIDERS,
  SESSION_MODES,
  THINKING_LEVELS,
} from "@ucode/contracts";

/** 界面上的一条消息：live 表示还在流式生成中 */
export type ChatItem = MessageDTO & { live?: boolean };
