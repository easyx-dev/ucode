/** web 侧类型出口：契约类型统一来自 @ucode/contracts，ChatItem 是界面状态 */
import type { MessageDTO } from "@ucode/contracts";

export type {
  ApiType,
  CatalogModel,
  CatalogProvider,
  ConfigSnapshot,
  ConfigTestResponse,
  ConfigView,
  HealthResponse,
  MessageBlock,
  MessageDTO,
  MessageRole,
  ModelsResponse,
  ProviderConfigView,
  ProviderModelView,
  RuntimeStatus,
  SessionListResponse,
  SessionSummary,
  ThinkingLevel,
} from "@ucode/contracts";

export { API_TYPES, THINKING_LEVELS } from "@ucode/contracts";

/** 界面上的一条消息：live 表示还在流式生成中 */
export type ChatItem = MessageDTO & { live?: boolean };
