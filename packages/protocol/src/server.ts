import type { ServerMessage } from "./envelope.ts";
import type { Capability, TrustLevel } from "./trust.ts";

/**
 * 绑定层面对的服务层契约（**叶子包里的接口，不是实现**）。
 *
 * 为什么放在 protocol：spec §7.2 要求 **bindings/* 不依赖 core**——否则"只装壳时依赖树里
 * 不含 core"这条反向验收必然失败。把协议 C 的类型**与它的服务端接口**一起下沉到叶子包，
 * 于是 core 与 bindings 都只依赖 protocol：core 实现它，绑定消费它，彼此不相识。
 */

/** 一条已接受的连接：绑定把收到的原始消息交给服务层，把服务层给的消息写回对端。 */
export type BindingConnection = {
  readonly id: string;
  readonly trustLevel: TrustLevel;
  readonly grantedCapabilities: Capability[];
  /**
   * 收原始消息（已反序列化的 JSON 值）。**解析由服务层做**：绑定只负责序列化、寻址、流式。
   */
  receive(raw: unknown): Promise<void>;
  /** 连接断开：卸载它的 attachment、撤回它在等的交互请求。 */
  close(): Promise<void>;
};

export type AttachCoreOptions = {
  /** 绑定名，用于诊断（stdio / unix / http / ws）。 */
  binding: string;
  /**
   * **信任级别由绑定声明，不由客户端自报**（ADR-004）。
   * 绑定知道自己的来历（父进程 spawn / 环回 / 非环回未认证），服务层只查表。
   */
  trustLevel: TrustLevel;
  /** 服务层 → 对端的唯一出口。 */
  send: (message: ServerMessage) => void;
};

/** 绑定层看到的服务层：只有挂载连接这一件事。 */
export type CoreServer = {
  readonly coreId: string;
  attachConnection(options: AttachCoreOptions): BindingConnection;
};

/** 绑定句柄：由各绑定包实现，CLI 用它统一起停。 */
export type TransportBinding = {
  readonly name: string;
  /** 这条通路在信任矩阵里的级别。 */
  readonly trustLevel: TrustLevel;
  /** 对端地址（stdio 无地址；unix 是 socket 路径；http/ws 是 URL）。 */
  readonly endpoint?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  connectionCount(): number;
};
