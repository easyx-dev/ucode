import type { Transport } from "@ucode/protocol";

/**
 * WebSocket 的**客户端一侧**：一帧一消息，断线后自动重连。
 * 服务端一侧在 `./index.ts`。
 */

export type WsClientOptions = {
  url: string;
  reconnectDelayMs?: number;
};

export function createWsClient(options: WsClientOptions): Transport {
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const errorHandlers: ((error: Error) => void)[] = [];
  let socket: WebSocket | undefined;
  let closed = false;
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function open(): void {
    socket = new WebSocket(options.url);
    socket.onopen = () => {
      resolveReady?.();
      resolveReady = undefined;
    };
    socket.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        for (const handler of messageHandlers) handler(parsed);
      } catch {
        // 忽略坏帧
      }
    };
    socket.onerror = () => {
      for (const handler of errorHandlers) handler(new Error("WebSocket 错误"));
    };
    socket.onclose = () => {
      if (closed) return;
      for (const handler of closeHandlers) handler("WebSocket 关闭");
      setTimeout(() => {
        if (!closed) open();
      }, options.reconnectDelayMs ?? 1_000);
    };
  }
  open();

  return {
    kind: "ws",
    send(message) {
      if (socket?.readyState === 1) socket.send(JSON.stringify(message));
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    onError(handler) {
      errorHandlers.push(handler);
    },
    async close() {
      closed = true;
      socket?.close();
      socket = undefined;
    },
    ready: () => readyPromise,
  };
}
