/**
 * /api/v1/terminal：终端的创建 / 列举 / 改尺寸 / 关闭、输出流的握手票，以及输出流本身。
 *
 * 输出流是 **WebSocket**（`GET /stream`），不是 SSE：终端是两个方向都高频的字节流，
 * 而且 xterm 的生态就长在 WS 上（客户端的管道交给 `@xterm/addon-attach`）。
 * 它的协议极简，全部落在 WS 自身的语义上（见 `packages/contracts` 的 terminal/output.ts）：
 * 上行文本 = 用户输入，下行二进制 = PTY 输出，结束与拒绝用关闭码表达。
 *
 * 因此这里没有帧格式、没有 JSON 包装、也没有队列：慢客户端的收敛交给 `bufferedAmount`。
 * 握手票的**预检**在鉴权中间件里（无效票连连接都不该建立），这里只做**核销**（一次性）。
 */

import type { NodeWebSocket } from "@hono/node-ws";
import {
  ERROR_CODES,
  TERMINAL_CLOSE_EXIT,
  TERMINAL_CLOSE_NOT_FOUND,
  TERMINAL_CLOSE_OVERFLOW,
  TERMINAL_CLOSE_UNAUTHORIZED,
  type TerminalCloseResponse,
  type TerminalCreateResponse,
  type TerminalListResponse,
  type TerminalResizeResponse,
  type TerminalTicketResponse,
  terminalCloseInputSchema,
  terminalCreateInputSchema,
  terminalListInputSchema,
  terminalResizeInputSchema,
  terminalStreamQuerySchema,
  terminalTicketInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import type { WebSocket as RawSocket } from "ws";

import { TERMINAL_MAX_BUFFERED_BYTES, TERMINAL_PING_INTERVAL_MS } from "../../constants/terminal";
import { logger } from "../../platform/logger";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

/** `readyState === 1` 即 OPEN；与 DOM 的 WebSocket 常量同值 */
const WS_OPEN = 1;

/** 握手阶段就拒绝：升级完成后改不了 HTTP 状态码，拒绝只能靠关闭码表达 */
const rejectOnOpen = (code: number, reason: string) => ({
  onOpen(_event: unknown, ws: WSContext<RawSocket>) {
    ws.close(code, reason);
  },
});

/**
 * 把一条已升级的连接接到某个终端上：回放快照、订阅输出、保活与清理。
 *
 * 抽成独立函数是因为它自带四段职责（回放 / 订阅 / 已结束收尾 / 保活），塞进 `onOpen` 里读不动。
 */
const attachTerminalStream = (input: {
  services: Services;
  terminalId: string;
  /** 原生 ws 实例：`send` 吃 Buffer，`ping` / `terminate` 也只有它有 */
  raw: RawSocket;
  /** hono 侧的连接上下文：`close` 是协议层关闭，交给它保证关闭帧写完整 */
  ws: WSContext<RawSocket>;
}): void => {
  const { services, terminalId, raw, ws } = input;

  // 快照与订阅在同一同步块内完成：中间插 await 就会漏掉这期间的输出
  const snapshot = services.terminals.snapshot(terminalId) ?? [];
  const unsubscribe = services.terminals.subscribe(terminalId, {
    onData: (chunk) => {
      if (raw.readyState !== WS_OPEN) return;
      // 客户端跟不上输出：断开让它重连，靠快照重放收敛，而不是把内存堆在这里
      if (raw.bufferedAmount > TERMINAL_MAX_BUFFERED_BYTES) {
        ws.close(TERMINAL_CLOSE_OVERFLOW, "overflow");
        return;
      }
      raw.send(chunk);
    },
    onExit: (exitCode) => {
      ws.close(TERMINAL_CLOSE_EXIT, `exit:${exitCode}`);
    },
  });
  // 订阅失败只可能是这一刻终端被关掉了
  if (!unsubscribe) {
    ws.close(TERMINAL_CLOSE_NOT_FOUND, "gone");
    return;
  }

  for (const chunk of snapshot) raw.send(chunk);

  // 已经结束的终端不会有新输出，补一帧结束信号即可收场
  const info = services.terminals.get(terminalId);
  if (info && !info.running) {
    unsubscribe();
    ws.close(TERMINAL_CLOSE_EXIT, `exit:${info.exitCode ?? 0}`);
    return;
  }

  // 判活的权威在服务端：浏览器端拿不到 pong，只有这里能决定什么时候踢掉半死的连接
  let alive = true;
  const pingTimer = setInterval(() => {
    if (!alive) {
      // 半死连接不等礼貌关闭：直接断，客户端按「可重连」处理
      raw.terminate();
      return;
    }
    alive = false;
    raw.ping();
  }, TERMINAL_PING_INTERVAL_MS);
  raw.on("pong", () => {
    alive = true;
  });
  raw.on("close", () => {
    clearInterval(pingTimer);
    unsubscribe();
  });
};

export const createTerminalRoute = (
  services: Services,
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"],
) => {
  const router = new Hono();

  router.post("/create", jsonBody(terminalCreateInputSchema), (c) => {
    const terminal: TerminalCreateResponse = services.terminals.create(c.req.valid("json"));
    return c.json(ok(terminal));
  });

  router.post("/list", jsonBody(terminalListInputSchema), (c) => {
    const result: TerminalListResponse = services.terminals.list(c.req.valid("json"));
    return c.json(ok(result));
  });

  router.post("/resize", jsonBody(terminalResizeInputSchema), (c) => {
    const result: TerminalResizeResponse = services.terminals.resize(c.req.valid("json"));
    return c.json(ok(result));
  });

  router.post("/close", jsonBody(terminalCloseInputSchema), (c) => {
    const result: TerminalCloseResponse = services.terminals.close(c.req.valid("json"));
    return c.json(ok(result));
  });

  // 握手票走正常鉴权（中间件覆盖 /api/v1/*），票本身是输出流那一次握手的凭证
  router.post("/ticket", jsonBody(terminalTicketInputSchema), (c) => {
    const { terminalId } = c.req.valid("json");
    const ticket = services.terminals.issueTicket(terminalId);
    if (!ticket) {
      throw new AppError(ERROR_CODES.terminalNotFound, `终端不存在或已结束：${terminalId}`, 404);
    }
    const result: TerminalTicketResponse = ticket;
    return c.json(ok(result));
  });

  router.get(
    "/stream",
    upgradeWebSocket((c) => {
      const parsed = terminalStreamQuerySchema.safeParse({
        terminalId: c.req.query("terminalId"),
        ticket: c.req.query("ticket"),
      });
      // 走到这里的请求，票已经在鉴权中间件里预检过；这里只做核销（一次性）与绑定复核
      if (!parsed.success) return rejectOnOpen(TERMINAL_CLOSE_UNAUTHORIZED, "invalid-handshake");

      const { terminalId } = parsed.data;
      if (services.terminals.redeemTicket(parsed.data.ticket) !== terminalId) {
        return rejectOnOpen(TERMINAL_CLOSE_UNAUTHORIZED, "invalid-ticket");
      }

      return {
        onOpen(_event, ws) {
          // 适配器保证升级成功后有原生实例；这里只是把可选类型收窄一次
          const raw = ws.raw;
          if (!raw) {
            ws.close(TERMINAL_CLOSE_OVERFLOW, "no-socket");
            return;
          }
          attachTerminalStream({ services, terminalId, raw, ws });
        },
        onMessage(event) {
          // 上行约定只有文本帧（用户输入原文，含控制序列）
          if (typeof event.data === "string") {
            services.terminals.write(terminalId, event.data);
            return;
          }
          // attach addon 的 `onBinary` 路径会发二进制帧；当前没有调用方走那条路，记一条便于排查
          logger.debug({ terminalId }, "终端收到二进制上行帧，已忽略");
        },
      };
    }),
  );

  return router;
};
