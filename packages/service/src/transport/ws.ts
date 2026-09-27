import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { CoreServer, TransportBinding, TrustLevel } from "@ucode/protocol";
import { isLoopbackHost, parseErrorResponse } from "@ucode/protocol";
import { Hono } from "hono";

/**
 * WebSocket 绑定（协议 B）：**一帧一消息**。
 *
 * WS 是双向传输，因此交互面天然支持——不需要 HTTP 那种"下行推、上行 POST"的配对
 * （spec §5.2 第 3 条只对纯请求-应答传输成立）。
 *
 * 暴露面规则同 HTTP（spec §5.3）：首发仅监听环回；非环回必须显式声明，且信任级别降为 untrusted。
 */

export type WsBindingOptions = {
  port?: number;
  host?: string;
  /** 路径，默认 /ws。 */
  path?: string;
  allowNonLoopback?: boolean;
};

export function createBinding(core: CoreServer, options: WsBindingOptions = {}): TransportBinding {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const wsPath = options.path ?? "/ws";
  const loopback = isLoopbackHost(host);

  if (!loopback && options.allowNonLoopback !== true) {
    throw new Error(
      `拒绝启动：WebSocket 绑定将监听非环回地址 ${host}，而首发没有认证机制。` +
        `请只监听 127.0.0.1，或显式传入 allowNonLoopback（此时信任级别降为 untrusted：只读 + 对话）。`,
    );
  }

  const trustLevel: TrustLevel = loopback ? "local" : "untrusted";
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  let closeServer: (() => Promise<void>) | undefined;
  let endpoint = `ws://${host}:${port}${wsPath}`;
  let active = 0;

  app.get("/health", (context) =>
    context.json({ ok: true, coreId: core.coreId, binding: "ws", trustLevel }),
  );

  app.get(
    wsPath,
    upgradeWebSocket(() => {
      let connection: ReturnType<CoreServer["attachConnection"]> | undefined;
      return {
        onOpen(_event, ws) {
          active += 1;
          connection = core.attachConnection({
            binding: "ws",
            trustLevel,
            send: (message) => {
              ws.send(JSON.stringify(message));
            },
          });
        },
        onMessage(event, ws) {
          // 一帧一消息：不做分帧，也不解析换行。
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          let value: unknown;
          try {
            value = JSON.parse(raw) as unknown;
          } catch (error) {
            // 帧解析失败：回一条无 id 的解析错误（无法得知 id）。
            ws.send(
              JSON.stringify(
                parseErrorResponse(
                  `帧不是合法 JSON：${error instanceof Error ? error.message : ""}`,
                ),
              ),
            );
            return;
          }
          void connection?.receive(value);
        },
        async onClose() {
          active -= 1;
          await connection?.close();
          connection = undefined;
        },
        onError() {
          void connection?.close();
        },
      };
    }),
  );

  return {
    name: "ws",
    trustLevel,
    get endpoint() {
      return endpoint;
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
          endpoint = `ws://${host}:${info.port}${wsPath}`;
          resolve();
        });
        server.on("error", reject);
        injectWebSocket(server);
        closeServer = async () => {
          const closed = new Promise<void>((closeResolve) => server.close(() => closeResolve()));
          (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
          await closed;
        };
      });
    },
    async stop() {
      await closeServer?.();
      closeServer = undefined;
    },
    connectionCount: () => active,
  };
}
