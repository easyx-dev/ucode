/**
 * 桌面端浏览器通道的进程内状态：接没接上、有哪些标签、当前在看哪一个。
 *
 * 只活在内存里，而且**只在桌面端接上时才有意义**：断开即清空（没有连接就没有可驱动的桌面浏览器，
 * agent 那边应当明确失败而不是驱动一个已经不存在的页面）。这里不认识 CDP，
 * 只回答「驱动哪一个」，命令怎么发见步骤 4 的通道实现。
 *
 * 握手票也放在这里：它是这条通道的准入凭证，与状态同生共死。
 */
import type { DesktopBrowserTab, DesktopCdpCommand, DesktopChannelState } from "@ucode/contracts";
import { DESKTOP_CHANNEL_CLOSE_REPLACED } from "@ucode/contracts";

import { createHandshakeTickets, type HandshakeTickets } from "../handshake-tickets";

/** 票绑定的资源：这条通道只有一个（桌面端本机一份），常量即可 */
const DESKTOP_CHANNEL_BOUND = "desktop";

/** 一条通道：能关掉它、能把一帧发下去；具体的 socket 形态由路由那侧管 */
export type DesktopChannel = {
  close: (code: number, reason: string) => void;
  send: (frame: DesktopCdpCommand) => void;
};

/** 桌面端转上来的 CDP 事件（只转发我们订阅得到的那些） */
export type DesktopCdpEvent = {
  webContentsId: number;
  method: string;
  params: Record<string, unknown>;
};

/** 等一条 CDP 命令回话的上限：超过就当这条通道没反应 */
export const DESKTOP_COMMAND_TIMEOUT_MS = 15_000;

export type DesktopBrowsers = {
  /** 桌面端接进来；同一时刻只留最新一条，被顶掉的那条会被关掉（4409），否则它会继续改状态 */
  attach: (channel: DesktopChannel) => void;
  /** 断开：只有当前这条通道能清掉状态（旧连接的 close 不该影响新连接） */
  detach: (channel: DesktopChannel) => void;
  /** 桌面端上报标签集合与激活项；不是当前那条通道的报送一律忽略 */
  setTabs: (channel: DesktopChannel, tabs: DesktopBrowserTab[]) => void;
  /** 当前状态 */
  state: () => DesktopChannelState;
  /**
   * 对某个 webContents 发一条 CDP 命令并等回话。
   * 通道不在、或到点没回话都会抛（调用方折成工具错误），不会挂在那里等下一次重连。
   */
  sendCommand: (
    webContentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  /** 订阅 CDP 事件（按 webContents 过滤由调用方做），返回退订 */
  subscribeCdp: (listener: (event: DesktopCdpEvent) => void) => () => void;
  /** 桌面端回来的结果：按 id 派回给等待者（只有当前那条通道的回报才算数） */
  applyResult: (channel: DesktopChannel, id: number, result: unknown, error?: string) => void;
  /** 桌面端转上来的事件（同样只认当前那条通道） */
  applyEvent: (channel: DesktopChannel, event: DesktopCdpEvent) => void;
  /** agent 要驱动的那一个；没有桌面端、或一个标签都没开时返回 null */
  activeTab: () => DesktopBrowserTab | null;
  issueTicket: () => { ticket: string; expiresAt: string };
  peekTicket: (ticket: string) => boolean;
  redeemTicket: (ticket: string) => boolean;
};

export const createDesktopBrowsers = (): DesktopBrowsers => {
  /** 当前那条通道：只存身份，不认识它怎么发数据 */
  let socket: DesktopChannel | null = null;
  let tabs: DesktopBrowserTab[] = [];
  const tickets: HandshakeTickets<string> = createHandshakeTickets<string>();
  const listeners = new Set<(event: DesktopCdpEvent) => void>();
  /** 等回话的命令：id → 收尾函数 */
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  let nextCommandId = 1;

  /** 通道没了就把等着的人全放掉：让他们等到超时只会让模型干等 */
  const failPending = (reason: string): void => {
    for (const [, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    pending.clear();
  };

  return {
    attach(next) {
      const previous = socket;
      socket = next;
      // 新通道接上时先清空：旧通道的标签在它断开时就该没了，留着会驱动到不存在的页面
      tabs = [];
      failPending("桌面端通道被新的连接顶掉了");
      // 同一个桌面端多开会互相顶掉：只关旧的会留一个还在发标签的连接，两边抢着改状态
      previous?.close(DESKTOP_CHANNEL_CLOSE_REPLACED, "replaced");
    },

    detach(current) {
      if (socket !== current) return;
      socket = null;
      tabs = [];
      failPending("桌面端通道已断开");
    },

    setTabs(channel, next) {
      // 身份校验不能省：被顶掉的旧连接还在发帧，落到这里就会把新连接的状态覆盖掉
      if (socket !== channel) return;
      tabs = next;
    },

    state: () => ({ connected: socket !== null, tabs }),

    sendCommand(webContentsId, method, params) {
      const channel = socket;
      if (!channel) {
        return Promise.reject(new Error("桌面端通道不在：它没在跑，或还没接上"));
      }
      const id = nextCommandId;
      nextCommandId += 1;
      const frame: DesktopCdpCommand = {
        type: "cdp",
        id,
        webContentsId,
        method,
        ...(params === undefined ? {} : { params }),
      };
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`桌面端 ${DESKTOP_COMMAND_TIMEOUT_MS}ms 没有回话（${method}）`));
        }, DESKTOP_COMMAND_TIMEOUT_MS);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        try {
          channel.send(frame);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    subscribeCdp(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    applyResult(channel, id, result, error) {
      if (socket !== channel) return;
      const waiter = pending.get(id);
      if (!waiter) return;
      pending.delete(id);
      clearTimeout(waiter.timer);
      if (error !== undefined) waiter.reject(new Error(error));
      else waiter.resolve(result);
    },

    applyEvent(channel, event) {
      if (socket !== channel) return;
      for (const listener of listeners) listener(event);
    },

    activeTab: () => tabs.find((tab) => tab.active) ?? null,

    // 首次连接也要票，所以不要求「已经接着」：调用方已经用凭证鉴权过（路由那侧）
    issueTicket: () => tickets.issue(DESKTOP_CHANNEL_BOUND),
    peekTicket: (ticket) => tickets.peek(ticket, DESKTOP_CHANNEL_BOUND),
    redeemTicket: (ticket) => tickets.redeem(ticket) === DESKTOP_CHANNEL_BOUND,
  };
};
