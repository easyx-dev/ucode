/**
 * 绑定层的**客户端一侧**契约（协议 B）。
 *
 * 与 `CoreServer`（服务端一侧）对称：绑定包同时提供"接上核心层"和"连上核心层"两半，
 * 因此 `sdk → bindings/*` 这条依赖边对应的是真实的代码关系，而不是声明的空壳。
 *
 * sdk 只认这个接口，不认具体传输——它保持 headless，浏览器与终端都能复用。
 */
export type TransportKind = "stdio" | "rpc" | "http" | "ws";

export type Transport = {
  readonly kind: TransportKind;
  /** 发一条客户端消息（绑定负责序列化与寻址）。 */
  send(message: unknown): void;
  /**
   * 收到一条原始消息（已反序列化的 JSON 值）。
   *
   * **解析交给消费方**（sdk），与服务端一侧对称：这样传输层不必懂协议语义，
   * 也能承载不属于协议 C 的传输级控制帧（如 SSE 的 stream.ready / stream.ping）。
   */
  onMessage(handler: (raw: unknown) => void): void;
  /** 连接断开（sdk 据此带游标重连）。 */
  onClose(handler: (reason?: string) => void): void;
  onError(handler: (error: Error) => void): void;
  close(): Promise<void>;
  /** 就绪：可以开始发消息了。 */
  ready(): Promise<void>;
};
