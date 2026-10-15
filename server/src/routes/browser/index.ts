/**
 * /api/v1/browser：浏览器 profile 的数据面（列举与清理），以及**桌面端浏览器通道**。
 *
 * 画面不在这里：桌面端用内置 webview 承载浏览器，用户在 panel 里直接看着 agent 操作；服务端通过这条通道
 * 知道「开了哪些标签、当前在看哪一个」（agent 驱动的是当前激活的那一个，见 docs/browser.md）。
 *
 * 通道是 WebSocket 升级端点（`GET /desktop`）：鉴权照终端那套——先带凭证换一张一次性握手票
 * （`POST /desktop/ticket`），票在鉴权中间件里**预检**（无效票连连接都不该建立），路由里只做**核销**。
 * 上行消息只有一种：整份标签集合（见 `@ucode/contracts` 的 browser/desktop.ts）。
 */

import type { NodeWebSocket } from "@hono/node-ws";
import {
  type BrowserDeleteResponse,
  type BrowserListResponse,
  browserDeleteInputSchema,
  browserListInputSchema,
  type DesktopChannelState,
  type DesktopTicketResponse,
  desktopChannelMessageSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import type { WebSocket as RawSocket } from "ws";

import { BROWSER_DESKTOP_PING_INTERVAL_MS } from "../../constants/browser";
import { logger } from "../../platform/logger";
import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";
import type { DesktopChannel } from "../../services/browser/desktop";

/** `readyState === 1` 即 OPEN；与 DOM 的 WebSocket 常量同值 */
const WS_OPEN = 1;

/** 握手阶段就拒绝：升级完成后改不了 HTTP 状态码，拒绝只能靠关闭码表达 */
const rejectOnOpen = (code: number, reason: string) => ({
  onOpen(_event: unknown, ws: WSContext<RawSocket>) {
    ws.close(code, reason);
  },
});

export const createBrowserRoute = (
  services: Services,
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"],
) => {
  const router = new Hono();

  router.post("/list", jsonBody(browserListInputSchema), (c) => {
    const result: BrowserListResponse = services.browsers.list();
    return c.json(ok(result));
  });

  router.post("/delete", jsonBody(browserDeleteInputSchema), (c) => {
    const result: BrowserDeleteResponse = services.browsers.delete(c.req.valid("json"));
    return c.json(ok(result));
  });

  // 桌面端通道的当前状态（排障与冒烟用；agent 是否驱动得了看它）
  router.post("/desktop", (c) => {
    const result: DesktopChannelState = services.browsers.desktop.state();
    return c.json(ok(result));
  });

  // 通道鉴权的一次性票：走正常鉴权（中间件覆盖 /api/v1/*），票本身是随后那次握手的凭证
  router.post("/desktop/ticket", (c) => {
    const result: DesktopTicketResponse = services.browsers.desktop.issueTicket();
    return c.json(ok(result));
  });

  router.get(
    "/desktop",
    upgradeWebSocket((c) => {
      // 走到这里的请求，票已经在鉴权中间件里预检过；这里只做核销（一次性）与绑定复核
      const ticket = c.req.query("ticket");
      if (!ticket || !services.browsers.desktop.redeemTicket(ticket)) {
        return rejectOnOpen(4401, "invalid-ticket");
      }

      const desktop = services.browsers.desktop;
      /*
        这一条连接的身份：状态与消息都按它归口，被顶掉之后它发来的标签不再生效。
        `close` 让「新连接顶掉旧连接」这件事由状态那侧发起（旧连接关掉才会停手）；
        socket 要等 `onOpen` 才拿得到，所以先留个槽。
      */
      const live: { ws: WSContext<RawSocket> | null } = { ws: null };
      const channel: DesktopChannel = {
        close: (code, reason) => live.ws?.close(code, reason),
        send: (frame) => live.ws?.send(JSON.stringify(frame)),
      };
      return {
        onOpen(_event, ws) {
          const raw = ws.raw;
          if (!raw) {
            ws.close(4403, "no-socket");
            return;
          }
          live.ws = ws;
          desktop.attach(channel);
          logger.info("桌面端浏览器通道已接入");

          let alive = true;
          const pingTimer = setInterval(() => {
            if (raw.readyState !== WS_OPEN) return;
            if (!alive) {
              // 半死连接不等礼貌关闭：直接断，桌面端会自己重连
              raw.terminate();
              return;
            }
            alive = false;
            raw.ping();
          }, BROWSER_DESKTOP_PING_INTERVAL_MS);
          raw.on("pong", () => {
            alive = true;
          });
          raw.on("close", () => {
            clearInterval(pingTimer);
            desktop.detach(channel);
            logger.info("桌面端浏览器通道已断开");
          });
        },
        onMessage(event) {
          if (typeof event.data !== "string") {
            logger.debug("桌面端浏览器通道收到非文本帧，已忽略");
            return;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(event.data);
          } catch {
            logger.warn("桌面端浏览器通道收到无法解析的帧，已忽略");
            return;
          }
          const parsed = desktopChannelMessageSchema.safeParse(payload);
          if (!parsed.success) {
            // 忽略而不是断开：两端版本不一致时断开会让它反复重连（客户端接上就重发一份）
            logger.warn({ issues: parsed.error.issues.length }, "桌面端浏览器通道收到不认识的消息");
            return;
          }
          if (parsed.data.type === "tabs") {
            desktop.setTabs(channel, parsed.data.tabs);
            logger.debug({ tabs: parsed.data.tabs.length }, "桌面端上报浏览器标签");
            return;
          }
          if (parsed.data.type === "cdp-result") {
            desktop.applyResult(
              channel,
              parsed.data.id,
              parsed.data.result,
              parsed.data.error?.message,
            );
            return;
          }
          desktop.applyEvent(channel, {
            webContentsId: parsed.data.webContentsId,
            method: parsed.data.method,
            params: parsed.data.params ?? {},
          });
        },
      };
    }),
  );

  return router;
};
