/**
 * @ucode/sdk —— headless 控制层 SDK：建连、命令封装、事件折叠、断线续传。
 *
 * 三条边界（spec §7.2）：
 * - **保持 headless**：不含 DOM、不含 UI 组件，因此 TUI 能只复用 sdk；
 * - 只依赖 `protocol` 与 `bindings/*`（传输由绑定包提供，sdk 不自己实现分帧）；
 * - 不依赖 `ui`，也不依赖任何 `apps/*`。
 *
 * 传输是**注入**的：Web 壳传 HTTP+SSE 的客户端（浏览器可用），TUI 传 stdio 或 rpc。
 * 这样 sdk 本身不会把 node 专有的模块带进浏览器打包结果。
 */

/** 壳子需要的协议类型：从 sdk 转发，避免控制层直接依赖 `protocol`（依赖图里没有这条边）。 */
export type {
  AutonomyLevel,
  Capability,
  ClientKind,
  ErrorInfo,
  Reference,
  SessionEntry,
  SessionState,
  SessionSummary,
  Transport,
  TrustLevel,
  UiRequest,
  Usage,
} from "@ucode/protocol";
export { type AgentSdk, type ConnectOptions, connect } from "./agent-sdk.ts";
export {
  applyServerMessage,
  createInitialState,
  type DisplayMessage,
  emptyView,
  type SdkNotice,
  type SdkState,
  type SessionView,
  toDisplayMessages,
} from "./reducer.ts";
