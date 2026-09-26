/**
 * @ucode/protocol —— 协议 C（核心层接口面）与协议 B（线格式）的消息类型。
 *
 * 叶子包：不依赖任何内部包。core 与 bindings 都只依赖它，
 * 因此 bindings 不必依赖 core（spec §7.2），"只装壳时依赖树里不含 core"才成立。
 *
 * 消息形状属【实现级】；三条**架构性**要求在这里是硬约束：
 * 1. 能力声明与能力授予分离（hello vs welcome）；
 * 2. 版本双向校验、从不静默降级（rejected + isVersionSupported）；
 * 3. 交互面方向与命令面相反（ClientMessage / ServerMessage 分开定义）。
 */
export * from "./channels.ts";
export * from "./commands.ts";
export * from "./envelope.ts";
export * from "./events.ts";
export * from "./handshake.ts";
export * from "./responses.ts";
export * from "./session.ts";
export * from "./trust.ts";
export * from "./ui.ts";
export * from "./version.ts";
