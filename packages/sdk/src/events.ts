/**
 * 全局事件流：持有单条 SSE 连接并按指数退避重连，向订阅者广播帧与连接状态。
 *
 * 事件与回调一律 `on<X>` 命名（见 AGENTS.md「语言规范」）；`server.connected` 作为连接信号
 * 只触发 `onConnected`，不进入 `onEvent`。错误帧同时进入 `onEvent` 与 `onError`。
 */
import type { ServerEvent } from "@ucode/contracts";

import { type ApiError, toApiError } from "./error";

export type EventConnect = (
  onEvent: (frame: ServerEvent) => void,
  signal: AbortSignal,
  /** 每读到一段数据（含 `: heartbeat` 注释行）时回调：看门狗靠它区分「安静」与「半死」 */
  onActivity: () => void,
) => Promise<void>;

export type EventStream = {
  /** 建立连接；重复调用无副作用 */
  start: () => void;
  /** 断开连接并停止重连 */
  stop: () => void;
  /** 订阅所有帧（不含 `server.connected`），返回退订函数 */
  onEvent: (listener: (frame: ServerEvent) => void) => () => void;
  /** 订阅错误帧，返回退订函数 */
  onError: (listener: (error: ApiError) => void) => () => void;
  /** 订阅连接建立，返回退订函数 */
  onConnected: (listener: () => void) => () => void;
  /** 订阅连接断开，返回退订函数 */
  onDisconnected: (listener: () => void) => () => void;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 连接空闲多久算半死。服务端每 15s 发一次心跳，取三倍余量：
 * TCP 未断但不再有数据的连接既不会 reject 也不会触发 `onDisconnected`，不主动断开就会一直停在生成中。
 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

export const createEventStream = (connect: EventConnect): EventStream => {
  const eventListeners = new Set<(frame: ServerEvent) => void>();
  const errorListeners = new Set<(error: ApiError) => void>();
  const connectedListeners = new Set<() => void>();
  const disconnectedListeners = new Set<() => void>();

  let controller: AbortController | null = null;
  let connected = false;
  let attempt = 0;

  const notifyConnected = (): void => {
    if (connected) return;
    connected = true;
    for (const listener of connectedListeners) listener();
  };

  const notifyDisconnected = (): void => {
    if (!connected) return;
    connected = false;
    for (const listener of disconnectedListeners) listener();
  };

  const run = async (): Promise<void> => {
    while (true) {
      const current = controller;
      if (!current || current.signal.aborted) return;
      let lastActivityAt = Date.now();
      const watchdog = setInterval(
        () => {
          if (Date.now() - lastActivityAt >= STREAM_IDLE_TIMEOUT_MS) current.abort();
        },
        Math.floor(STREAM_IDLE_TIMEOUT_MS / 3),
      );
      try {
        await connect(
          (frame) => {
            lastActivityAt = Date.now();
            if (frame.type === "server.connected") {
              attempt = 0;
              notifyConnected();
              return;
            }
            for (const listener of eventListeners) listener(frame);
            if (frame.type === "error") {
              const error = toApiError(frame);
              for (const listener of errorListeners) listener(error);
            }
          },
          current.signal,
          () => {
            lastActivityAt = Date.now();
          },
        );
      } catch {
        // 连接失败或被中断，统一走下面的退避重连
      } finally {
        clearInterval(watchdog);
      }

      notifyDisconnected();
      if (current.signal.aborted) return;

      attempt += 1;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10_000));
      // 退避期间若被 stop（或 stop 后重启）替换了 controller，本次循环退出，避免两条连接并存
      if (controller !== current) return;
    }
  };

  return {
    start() {
      if (controller) return;
      controller = new AbortController();
      void run();
    },
    stop() {
      controller?.abort();
      controller = null;
      attempt = 0;
      notifyDisconnected();
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
    onConnected(listener) {
      connectedListeners.add(listener);
      return () => {
        connectedListeners.delete(listener);
      };
    },
    onDisconnected(listener) {
      disconnectedListeners.add(listener);
      return () => {
        disconnectedListeners.delete(listener);
      };
    },
  };
};
