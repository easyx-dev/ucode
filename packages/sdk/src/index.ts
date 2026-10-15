/**
 * `@ucode/sdk`：server `/api/v1` 的跨端客户端封装。
 *
 * 纯逻辑、无 React / DOM 依赖：web、桌面、TUI 共用。分两层——
 * `createApis` 是无状态接口层（一方法一接口），`createClient` 在其上装配事件流与各域同步状态，
 * React 侧用 `useSyncExternalStore` 订阅 store。
 */
export { type Apis, type ApisOptions, createApis } from "./apis";
export { type Client, type ClientOptions, createClient } from "./client";
export {
  ApiError,
  type ApiErrorOptions,
  asApiError,
  describeApiError,
  describeError,
  interpolate,
  isApiError,
  type Translate,
  toApiError,
} from "./error";
export { createEventStream, type EventConnect, type EventStream } from "./events";
export {
  createReconnectingStream,
  type ReconnectingStream,
  type ReconnectingStreamOptions,
  type StreamConnect,
} from "./reconnect";
export { readSseStream } from "./sse";
export { createStore, type Store } from "./store";
export { type AssetsState, type AssetsStore, createAssetsStore } from "./stores/assets";
export { type AuthState, type AuthStore, createAuthStore } from "./stores/auth";
export { type CommandAssets, type CommandsStore, createCommandsStore } from "./stores/commands";
export { type ConfigState, type ConfigStore, createConfigStore } from "./stores/config";
export { createGoalStore, type GoalInput, type GoalState, type GoalStore } from "./stores/goal";
export {
  createInteractionsStore,
  type InteractionsState,
  type InteractionsStore,
} from "./stores/interactions";
export { createMcpStore, type McpState, type McpStore } from "./stores/mcp";
export {
  createMessagesStore,
  type MessagesStore,
  type SessionStreamState,
} from "./stores/messages";
export { createModelsStore, type ModelsState, type ModelsStore } from "./stores/models";
export {
  createPluginsStore,
  type PluginsState,
  type PluginsStore,
} from "./stores/plugins";
export { createSessionsStore, type SessionsState, type SessionsStore } from "./stores/sessions";
export { createStatusStore, type StatusStore } from "./stores/status";
export { createUsageStore, type UsageState, type UsageStore } from "./stores/usage";
export {
  createTerminalSocket,
  type TerminalExit,
  type TerminalSocket,
  type TerminalSocketLike,
  type TerminalSocketOptions,
} from "./terminal-socket";
export {
  createTransport,
  type FetchLike,
  type Transport,
  type TransportOptions,
} from "./transport";
export type {
  ChatItem,
  ChatItemTiming,
  EditMessagePayload,
  PromptPayload,
  SubagentStream,
  SubagentStreams,
} from "./types";
