/**
 * @ucode/core —— 协议 C 服务端：握手、attachment、会话运行时、交互中转、资源与工具。
 *
 * 定位（spec §4.1）：核心层**不渲染界面**，也**不知道对端是什么传输**。
 * 它只对外暴露一套与传输无关的接口面：绑定层把消息解出来交给 `Core.attachConnection().receive()`，
 * 把核心层给的消息写回连接。
 *
 * 与其他包的边界：
 * - 只依赖 `@ucode/store`（数据层唯一入口）与 `@ucode/protocol`（协议 C 类型）；
 * - 不依赖任何 `bindings/*`（核心层不知道传输）；
 * - agent loop、工具执行、插件运行时来自基座 `@earendil-works/pi-coding-agent`。
 */
export * from "./core.ts";
export * from "./handshake.ts";
export * from "./models.ts";
export * from "./pty.ts";
export * from "./session-runtime.ts";
export * from "./tool-gate.ts";
export * from "./trust.ts";
export * from "./types.ts";
export * from "./ui-broker.ts";
export * from "./ui-context.ts";
export * from "./workspace.ts";
