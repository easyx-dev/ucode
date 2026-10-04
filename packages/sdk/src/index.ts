/**
 * `@ucode/sdk`：server `/api/v1` 的跨端客户端封装。
 *
 * 纯逻辑、无 React / DOM 依赖：web、Electron、TUI 共用。传输层（`createClient`）与
 * 状态层（store）都在这里，React 侧只需用 `useSyncExternalStore` 订阅。
 */
export { type ClientOptions, createClient, type UcodeClient } from "./client";
export {
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
  createTransport,
  type FetchLike,
  type Transport,
  type TransportOptions,
} from "./transport";
