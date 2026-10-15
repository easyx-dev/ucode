/**
 * 终端输出流的连接管理：取票 → 建 WebSocket → 把 socket 交给调用方 → 按关闭码收尾。
 *
 * 数据面不在这里：socket 一建立就交出去（UI 侧交给 `@xterm/addon-attach`），这里只管三件事——
 * 握手票（浏览器的 WS 带不了 `Authorization`，凭证又不走 Cookie）、退避重连、
 * 以及「这条连接是结束了还是断了」的判定（全靠关闭码，见 `contracts` 的 TERMINAL_CLOSE_*）。
 */
import {
  ERROR_CODES,
  TERMINAL_CLOSE_EXIT,
  TERMINAL_CLOSE_NOT_FOUND,
  TERMINAL_CLOSE_UNAUTHORIZED,
} from "@ucode/contracts";

import type { Apis } from "./apis";
import { isApiError } from "./error";

/**
 * 够用的 WebSocket 形状：浏览器与 Node 的实例都满足，测试里注入假实现。
 * 只声明这里真正用到的成员，免得把 DOM 与 Node 两套 WebSocket 类型搅在一起。
 */
export type TerminalSocketLike = {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

export type TerminalSocket = {
  /** 开始连接；重复调用无副作用 */
  start: () => void;
  /** 断开并停止重连 */
  stop: () => void;
  /** 每次连接成功都触发（含重连）：在这里把 socket 接到终端上 */
  onOpen: (listener: (socket: TerminalSocketLike) => void) => () => void;
  /** 非首次连接成功：服务端会重放整段历史，调用方据此先清屏 */
  onReconnect: (listener: () => void) => () => void;
  /** 终态：进程结束（带退出码）、终端已不存在、凭证失效。触发后不再重连，重新开始要再调 `start` */
  onExit: (listener: (exit: TerminalExit) => void) => () => void;
};

/**
 * 输出流的终态。分三种是为了让界面能说清「为什么停在这」：进程结束能报退出码，
 * 终端不存在（被关掉、服务重启后终端是内存态）与凭证失效是完全不同的两回事，
 * 提示与能否自行恢复都不一样。
 */
export type TerminalExit =
  | { kind: "exit"; exitCode: number }
  | { kind: "gone" }
  | { kind: "unauthorized" };

/** 退避上限：断网时不必无限拉长，恢复后要能立刻重连 */
const RECONNECT_MAX_DELAY_MS = 10_000;

/**
 * 取票阶段就能判定「再试也没用」的错误码：终端已不存在（服务重启后终端是内存态，全没了）、
 * 或凭证失效。把 404 当网络抖动来重连，就是页面挂着一个早已消失的终端每 10 秒敲一次服务端。
 */
const FATAL_TICKET_EXITS: Record<string, TerminalExit> = {
  [ERROR_CODES.terminalNotFound]: { kind: "gone" },
  [ERROR_CODES.unauthorized]: { kind: "unauthorized" },
};

/** 关闭码 → 终态；网络抖动、服务端因客户端跟不上而踢连接时返回 null（可重连） */
const outcomeOf = (code: number, reason: string): TerminalExit | null => {
  if (code === TERMINAL_CLOSE_EXIT) {
    const matched = /^exit:(-?\d+)$/.exec(reason);
    return { kind: "exit", exitCode: matched?.[1] ? Number(matched[1]) : 0 };
  }
  if (code === TERMINAL_CLOSE_UNAUTHORIZED) return { kind: "unauthorized" };
  // 终端没了：重连多少次都一样，停在这
  if (code === TERMINAL_CLOSE_NOT_FOUND) return { kind: "gone" };
  return null;
};

export type TerminalSocketOptions = {
  terminals: Apis["terminal"];
  terminalId: string;
  /** 测试注入；缺省用全局 WebSocket */
  createSocket?: (url: string) => TerminalSocketLike;
};

export const createTerminalSocket = (options: TerminalSocketOptions): TerminalSocket => {
  const openListeners = new Set<(socket: TerminalSocketLike) => void>();
  const reconnectListeners = new Set<() => void>();
  const exitListeners = new Set<(exit: TerminalExit) => void>();
  const makeSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as TerminalSocketLike);

  let running = false;
  let opens = 0;
  let attempt = 0;
  let socket: TerminalSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notifyExit = (exit: TerminalExit): void => {
    running = false;
    socket = null;
    for (const listener of exitListeners) listener(exit);
  };

  const scheduleReconnect = (): void => {
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
    // 定时器不该拖住宿主退出（桌面端关窗时它可能还在等重连）
    timer.unref?.();
  };

  const connect = async (): Promise<void> => {
    if (!running) return;
    let ticket: string;
    try {
      ({ ticket } = await options.terminals.ticket({ terminalId: options.terminalId }));
    } catch (error) {
      if (!running) return;
      // 取不到票：终态错误直接收场，其余（服务刚重启、网络断）退避重连
      const fatal = isApiError(error) ? FATAL_TICKET_EXITS[error.code] : undefined;
      if (fatal) {
        notifyExit(fatal);
        return;
      }
      scheduleReconnect();
      return;
    }
    if (!running) return;

    // 拼地址失败是装配错误（没给它 WebSocket 基址）：直接抛出去，别混进「网络不好」里静默重连
    const url = options.terminals.websocketUrl(options.terminalId, ticket);

    const current = makeSocket(url);
    current.binaryType = "arraybuffer";
    socket = current;

    current.onopen = () => {
      attempt = 0;
      if (opens > 0) {
        for (const listener of reconnectListeners) listener();
      }
      opens += 1;
      for (const listener of openListeners) listener(current);
    };
    current.onclose = (event) => {
      // 已经被 stop 或换代的连接不再参与收尾
      if (socket !== current) return;
      socket = null;
      if (!running) return;
      const outcome = outcomeOf(event.code, event.reason);
      if (outcome) {
        notifyExit(outcome);
        return;
      }
      scheduleReconnect();
    };
    // 出错一定伴随 close，收尾只在 onclose 做，避免两条路径各判一次
    current.onerror = () => {};
  };

  return {
    start() {
      if (running) return;
      running = true;
      opens = 0;
      attempt = 0;
      void connect();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const current = socket;
      socket = null;
      current?.close();
    },
    onOpen(listener) {
      openListeners.add(listener);
      return () => {
        openListeners.delete(listener);
      };
    },
    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
  };
};
