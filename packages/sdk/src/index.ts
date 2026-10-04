/**
 * `@ucode/sdk`：server `/api/v1` 的跨端客户端封装。
 *
 * 纯逻辑、无 React / DOM 依赖：web、Electron、TUI 共用。`createClient` 是无状态接口层，
 * `createSdk` 额外装配事件流与会话流等状态 store；React 侧用 `useSyncExternalStore` 订阅。
 */
export { createSdk, type Sdk, type SdkOptions } from "./app";
export {
  appendUserItem,
  asRecord,
  reduceEvent,
  removeUserItem,
  settle,
} from "./chat-reducer";
export { type ClientOptions, createClient, type UcodeClient } from "./client";
export {
  describeApiError,
  describeError,
  interpolate,
  isSdkError,
  SdkError,
  type SdkErrorOptions,
  type Translate,
} from "./error";
export { createEventStream, type EventStream, type EventSubscribe } from "./events";
export { readSseStream } from "./sse";
export { createStore, type Store } from "./store";
export {
  createSessionStreams,
  type SessionStreamState,
  type SessionStreams,
} from "./stream/session";
export {
  createTransport,
  type FetchLike,
  type Transport,
  type TransportOptions,
} from "./transport";
export type { ChatItem, PromptPayload, SubagentStream, SubagentStreams } from "./types";
