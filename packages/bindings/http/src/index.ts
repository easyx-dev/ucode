import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { CoreServer, ServerMessage, TransportBinding, TrustLevel } from "@ucode/protocol";
import { isLoopbackHost, parseErrorResponse } from "@ucode/protocol";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * HTTP + SSE 绑定（协议 B）。
 *
 * 纯请求-应答的传输**必须配对**（spec §5.2 第 3 条）：下行用 SSE 推（含 `ui.request`），
 * 上行用 POST 提交（含 `ui.response`），按标识配对。绑定自己不做任何配对逻辑——
 * 它只是把两个方向接到同一条协议 C 连接上（以 `x-client-id` 为寻址）。
 *
 * 暴露面规则（spec §5.3）：**首发仅监听环回**。监听非环回时若无认证配置则**拒绝启动**
 * ——不允许出现"无意间暴露了一个无认证的端口"。
 *
 * 同一端口顺带把 Web 壳的静态资源发出去，于是 Web 壳与核心层同源，没有 CORS 与 cookie 的麻烦。
 */

export type HttpBindingOptions = {
  port?: number;
  host?: string;
  /** Web 壳构建产物目录（可选）。给了它就同时提供静态资源与 SPA 回退。 */
  staticDir?: string;
  /**
   * 显式允许非环回监听（此时信任级别降为 `untrusted`：只读 + 对话）。
   * 首发的正确做法是"要么只监听本机，要么显式表达你知道自己在暴露什么"。
   */
  allowNonLoopback?: boolean;
};

type HttpConnection = {
  connection: ReturnType<CoreServer["attachConnection"]>;
  /** 当前 SSE 流（控制层断开时为空）。 */
  stream: { write: (text: string) => void; close: () => void } | undefined;
  /** 控制层还没连上事件流时，先攒着。 */
  buffered: ServerMessage[];
  lastSeen: number;
};

const KEEPALIVE_MS = 15_000;
const IDLE_SWEEP_MS = 30_000;
/** 控制层断开后保留连接多久（等它带游标重连，而不是当场丢掉 attachment）。 */
const STREAMLESS_TTL_MS = 5 * 60_000;

export function createBinding(
  core: CoreServer,
  options: HttpBindingOptions = {},
): TransportBinding {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const loopback = isLoopbackHost(host);

  if (!loopback && options.allowNonLoopback !== true) {
    throw new Error(
      `拒绝启动：HTTP 绑定将监听非环回地址 ${host}，而首发没有认证机制。` +
        `请只监听 127.0.0.1，或显式传入 allowNonLoopback（此时信任级别降为 untrusted：只读 + 对话）。`,
    );
  }

  const trustLevel: TrustLevel = loopback ? "local" : "untrusted";
  const connections = new Map<string, HttpConnection>();
  let closeServer: (() => Promise<void>) | undefined;
  let endpoint = `http://${host}:${port}`;

  function acquire(clientId: string): HttpConnection {
    const existing = connections.get(clientId);
    if (existing !== undefined) {
      existing.lastSeen = Date.now();
      return existing;
    }
    const state: HttpConnection = {
      connection: undefined as never,
      stream: undefined,
      buffered: [],
      lastSeen: Date.now(),
    };
    state.connection = core.attachConnection({
      binding: "http",
      trustLevel,
      send: (message: ServerMessage) => {
        const current = connections.get(clientId);
        if (current === undefined) return;
        if (current.stream === undefined) {
          // 控制层暂时没有事件流（正在重连）：先把消息攒着，等它回来一次性补齐。
          current.buffered.push(message);
          if (current.buffered.length > 2_000) current.buffered.shift();
          return;
        }
        current.stream.write(`data: ${JSON.stringify(message)}\n\n`);
      },
    });
    connections.set(clientId, state);
    return state;
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [clientId, state] of connections) {
      if (state.stream === undefined && now - state.lastSeen > STREAMLESS_TTL_MS) {
        connections.delete(clientId);
        void state.connection.close();
      }
    }
  }, IDLE_SWEEP_MS);
  sweeper.unref?.();

  const app = new Hono();

  app.get("/health", (context) =>
    context.json({ ok: true, coreId: core.coreId, binding: "http", trustLevel }),
  );

  app.post("/rpc", async (context) => {
    const clientId = context.req.header("x-client-id") ?? "default";
    const state = acquire(clientId);
    let value: unknown;
    try {
      value = await context.req.json();
    } catch (error) {
      const message = parseErrorResponse(
        `请求体不是合法 JSON：${error instanceof Error ? error.message : ""}`,
      );
      if (state.stream === undefined) state.buffered.push(message);
      else state.stream.write(`data: ${JSON.stringify(message)}\n\n`);
      return context.json({ accepted: false }, 400);
    }
    // 应答从事件流回去（按标识配对），这里只确认收到。
    await state.connection.receive(value);
    return context.json({ accepted: true }, 202);
  });

  app.get("/events", (context) => {
    const clientId =
      context.req.query("clientId") ?? context.req.header("x-client-id") ?? "default";
    const state = acquire(clientId);
    return streamSSE(context, async (stream) => {
      state.stream = {
        write: (text) => {
          void stream.write(text);
        },
        close: () => {
          void stream.close();
        },
      };
      stream.onAbort(() => {
        if (state.stream !== undefined) state.stream = undefined;
        state.lastSeen = Date.now();
      });

      for (const message of state.buffered.splice(0)) {
        await stream.writeSSE({ data: JSON.stringify(message) });
      }
      await stream.writeSSE({
        data: JSON.stringify({ type: "stream.ready", coreId: core.coreId }),
      });

      for (;;) {
        await stream.sleep(KEEPALIVE_MS);
        try {
          await stream.writeSSE({ data: JSON.stringify({ type: "stream.ping", at: Date.now() }) });
        } catch {
          break;
        }
        if (state.stream === undefined) break;
      }
    });
  });

  if (options.staticDir !== undefined) {
    const root = options.staticDir;
    app.use("/*", serveStatic({ root }));
    // SPA 回退：非 API 路径统一交给前端路由
    app.get("*", serveStatic({ path: join(root, "index.html") }));
  }

  const binding: TransportBinding = {
    name: "http",
    trustLevel,
    get endpoint() {
      return endpoint;
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
          endpoint = `http://${host}:${info.port}`;
          resolve();
        });
        server.on("error", reject);
        closeServer = async () => {
          // SSE 是长连接：只 close() 会一直等它们自己结束，优雅退出会卡住。
          // 因此"停止接受新连接"之后**强制断开**仍然挂着的连接。
          const closed = new Promise<void>((closeResolve) => server.close(() => closeResolve()));
          (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
          await closed;
        };
      });
    },
    async stop() {
      clearInterval(sweeper);
      for (const state of connections.values()) {
        state.stream?.close();
        await state.connection.close();
      }
      connections.clear();
      await closeServer?.();
      closeServer = undefined;
    },
    connectionCount: () => connections.size,
  };

  return binding;
}
