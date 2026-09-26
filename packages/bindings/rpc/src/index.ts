import { unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import type { CoreServer, ServerMessage, TransportBinding, TrustLevel } from "@ucode/protocol";
import { isLoopbackHost, parseErrorResponse } from "@ucode/protocol";

/**
 * rpc 绑定（协议 B）：unix socket 或 TCP，**4 字节大端长度前缀 + JSON 载荷**。
 *
 * 与 stdio 刻意不统一（spec §5.5）：stdio 用 JSONL（可被人直接阅读、可用 `jq` 处理），
 * rpc 用长度前缀（纯机器通道，彻底绕开换行歧义——连 `U+2028` 的讨论都不需要）。
 *
 * 信任级别：
 * - unix socket → `local`（受文件权限约束：能连上就是同一个 OS 用户）；
 * - TCP 环回 → `local`；
 * - TCP 非环回 → `untrusted`（首发没有认证，非环回通路上什么都证明不了）。
 */

export type RpcBindingOptions = {
  /** unix socket 路径；给了它就不监听 TCP。 */
  socketPath?: string;
  port?: number;
  host?: string;
  /** 覆盖信任级别（默认按监听地址推导）。 */
  trustLevel?: TrustLevel;
};

const HEADER_BYTES = 4;

export function createBinding(core: CoreServer, options: RpcBindingOptions = {}): TransportBinding {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const socketPath = options.socketPath;
  const trustLevel: TrustLevel =
    options.trustLevel ??
    (socketPath !== undefined || isLoopbackHost(host) ? "local" : "untrusted");

  let server: Server | undefined;
  const clients = new Set<Socket>();
  let endpoint = socketPath ?? `tcp://${host}:${port}`;

  function handleSocket(socket: Socket): void {
    clients.add(socket);
    const connection = core.attachConnection({
      binding: socketPath === undefined ? "tcp" : "unix",
      trustLevel,
      send: (message: ServerMessage) => {
        if (socket.destroyed) return;
        const payload = Buffer.from(JSON.stringify(message), "utf8");
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeUInt32BE(payload.length, 0);
        socket.write(Buffer.concat([header, payload]));
      },
    });

    let buffer: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < HEADER_BYTES) return;
        const length = buffer.readUInt32BE(0);
        if (buffer.length < HEADER_BYTES + length) return;
        const payload = buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
        buffer = buffer.subarray(HEADER_BYTES + length);
        let value: unknown;
        try {
          value = JSON.parse(payload.toString("utf8")) as unknown;
        } catch (error) {
          socket.write(
            encode(
              parseErrorResponse(
                `消息不是合法 JSON：${error instanceof Error ? error.message : ""}`,
              ),
            ),
          );
          continue;
        }
        void connection.receive(value);
      }
    });

    const teardown = (): void => {
      clients.delete(socket);
      void connection.close();
    };
    socket.on("close", teardown);
    socket.on("error", teardown);
  }

  const binding: TransportBinding = {
    name: "rpc",
    trustLevel,
    get endpoint() {
      return endpoint;
    },
    async start() {
      server = createServer(handleSocket);
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        if (socketPath === undefined) {
          server?.listen(port, host, () => resolve());
        } else {
          server?.listen(socketPath, () => resolve());
        }
      });
      const address = server.address();
      if (socketPath === undefined && typeof address === "object" && address !== null) {
        endpoint = `tcp://${host}:${address.port}`;
      }
    },
    async stop() {
      for (const client of clients) client.destroy();
      clients.clear();
      await new Promise<void>((resolve) => {
        if (server === undefined) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      server = undefined;
      if (socketPath !== undefined) await unlink(socketPath).catch(() => undefined);
    },
    connectionCount: () => clients.size,
  };

  return binding;
}

function encode(message: ServerMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
