/**
 * 桌面端到服务端的浏览器通道：把「工作台里开了哪些浏览器标签、当前在看哪一个」报给服务端。
 *
 * 服务端据此决定 agent 驱动哪一个（画面在桌面端自己的 webview 里，见 docs/browser.md）。通道断开对桌面端
 * 没有别的收尾：服务端那边会把状态清空，「没有可驱动的桌面浏览器」由它去表达。
 *
 * 连接自己重试：服务可能晚于桌面端启动、或重启换了端口与 token，因此每次重连都**重读注册文件、重新换票**；
 * 接上后立刻整份重发当前标签，避免「重连后服务端一直显示零个标签」。
 * 上行帧只有一种（见 `@ucode/contracts` 的 browser/desktop.ts），非法帧由服务端忽略。
 */
import {
  DESKTOP_CHANNEL_CLOSE_REPLACED,
  type DesktopBrowserTab,
  type DesktopCdpCommand,
} from "@ucode/contracts";
import { ipcMain, webContents } from "electron";

import { BROWSER_TABS_CHANNEL } from "../shared/browser-tabs.ts";
import { createCdpForwarder, type GuestHandle } from "./cdp-forward.ts";
import { readServiceConnection } from "./connection.ts";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

/** 当前那条通道：CDP 转发要往它回帧，所以放在模块作用域（连接生命周期仍是 `registerBrowserChannelIpc` 管的） */
let socket: WebSocket | null = null;

/**
 * 服务端发来的 CDP 命令转给浏览器标签：只认本应用创建的 webview guest（见 `cdp-forward.ts`）。
 * 这里只做 electron 侧的接线：找 webContents、把帧发回通道。
 */
const cdp = createCdpForwarder({
  lookup: (id) => webContents.fromId(id) as GuestHandle | undefined,
  send: (frame) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  },
});

/** 渲染层挂上一个浏览器标签（`did-attach-webview`）时登记它：只有登记过的 id 服务端才驱动得了 */
export const registerBrowserGuest = (id: number): void => cdp.register(id);
/** 标签销毁时注销 */
export const unregisterBrowserGuest = (id: number): void => cdp.unregister(id);

export const registerBrowserChannelIpc = (): void => {
  let tabs: DesktopBrowserTab[] = [];
  let retryMs = RECONNECT_MIN_MS;
  /** 被顶掉之后停手（等下一次用户动标签再试），其余情况一直重连 */
  let stopped = false;

  const sendTabs = (): void => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "tabs", tabs }));
  };

  const scheduleRetry = (): void => {
    if (stopped) return;
    const timer = setTimeout(() => {
      retryMs = Math.min(RECONNECT_MAX_MS, retryMs * 2);
      void connect();
    }, retryMs);
    // 重连定时器不该拖住应用退出
    timer.unref();
  };

  const connect = async (): Promise<void> => {
    if (stopped || socket !== null) return;
    const service = readServiceConnection();
    if (!service) {
      scheduleRetry();
      return;
    }

    // 先换一张一次性握手票：WS 握手走的是票，不走长期凭证（与终端输出流同一套）
    let ticket: string;
    try {
      const response = await fetch(`${service.baseUrl}/api/v1/browser/desktop/ticket`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${service.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok) throw new Error(`ticket ${response.status}`);
      const body = (await response.json()) as { data?: { ticket?: string } };
      if (!body.data?.ticket) throw new Error("ticket 响应缺少 ticket");
      ticket = body.data.ticket;
    } catch {
      scheduleRetry();
      return;
    }

    const url = `${service.baseUrl.replace(/^http/, "ws")}/api/v1/browser/desktop?ticket=${encodeURIComponent(ticket)}`;
    const next = new WebSocket(url);
    socket = next;
    next.onopen = () => {
      retryMs = RECONNECT_MIN_MS;
      sendTabs();
    };
    next.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof frame !== "object" || frame === null) return;
      if ((frame as { type?: unknown }).type !== "cdp") return;
      void cdp.handle(frame as DesktopCdpCommand);
    };
    next.onclose = (event) => {
      socket = null;
      // 被同一个桌面端的另一条实例顶掉了：停手，等下一次标签变化（那时多半已经轮到自己）
      if (event.code === DESKTOP_CHANNEL_CLOSE_REPLACED) {
        stopped = true;
        return;
      }
      scheduleRetry();
    };
  };

  ipcMain.on(BROWSER_TABS_CHANNEL, (_event, next: unknown) => {
    if (!Array.isArray(next)) return;
    tabs = next as DesktopBrowserTab[];
    // 被顶掉之后停过手：用户又动了标签，这时再试一次
    if (stopped) {
      stopped = false;
      retryMs = RECONNECT_MIN_MS;
      void connect();
    }
    // 已经接上就直接推：标签变化是用户操作触发的，不需要再等一次重连
    sendTabs();
  });

  void connect();
};
