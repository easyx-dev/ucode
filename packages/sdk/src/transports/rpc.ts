import { connect as netConnect, type Socket } from "node:net";
import type { Transport } from "@ucode/protocol";

/**
 * rpc 的**客户端一侧**：4 字节大端长度前缀 + JSON 载荷。
 * 服务端一侧在 `./index.ts`。
 */

export type RpcClientOptions = {
  socketPath?: string;
  host?: string;
  port?: number;
};

export function createClient(options: RpcClientOptions): Transport {
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const errorHandlers: ((error: Error) => void)[] = [];
  let buffer: Buffer = Buffer.alloc(0);
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const socket: Socket = netConnect(
    options.socketPath !== undefined
      ? { path: options.socketPath }
      : { host: options.host ?? "127.0.0.1", port: options.port ?? 0 },
    () => resolveReady?.(),
  );

  socket.on("error", (error) => {
    rejectReady?.(error);
    for (const handler of errorHandlers) handler(error);
  });
  socket.on("close", () => {
    for (const handler of closeHandlers) handler("socket 关闭");
  });
  socket.on("data", (chunk: Buffer) => {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 4) return;
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) return;
      const payload = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      try {
        const parsed: unknown = JSON.parse(payload);
        for (const handler of messageHandlers) handler(parsed);
      } catch {
        // 忽略坏帧
      }
    }
  });

  return {
    kind: "rpc",
    send(message) {
      const payload = Buffer.from(JSON.stringify(message), "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length, 0);
      socket.write(Buffer.concat([header, payload]));
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
      socket.destroy();
    },
    ready: () => readyPromise,
  };
}
