/** 全局事件流：持有单条 SSE 连接并按指数退避重连，向订阅者广播帧与连接状态 */
import type { ServerEvent } from "@ucode/contracts";

export type EventSubscribe = (
  onEvent: (frame: ServerEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

export type EventStream = {
  /** 建立连接；重复调用无副作用 */
  start: () => void;
  /** 断开连接并停止重连 */
  stop: () => void;
  /** 订阅事件帧，返回退订函数 */
  subscribe: (listener: (frame: ServerEvent) => void) => () => void;
  /** 订阅连接状态，返回退订函数 */
  onStatus: (listener: (connected: boolean) => void) => () => void;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createEventStream = (subscribe: EventSubscribe): EventStream => {
  const listeners = new Set<(frame: ServerEvent) => void>();
  const statusListeners = new Set<(connected: boolean) => void>();

  let controller: AbortController | null = null;
  let connected = false;
  let attempt = 0;

  const notifyStatus = (next: boolean): void => {
    if (connected === next) return;
    connected = next;
    for (const listener of statusListeners) listener(next);
  };

  const run = async (): Promise<void> => {
    while (true) {
      const current = controller;
      if (!current || current.signal.aborted) return;
      try {
        await subscribe((frame) => {
          if (frame.type === "server.connected") {
            attempt = 0;
            notifyStatus(true);
            return;
          }
          for (const listener of listeners) listener(frame);
        }, current.signal);
      } catch {
        // 连接失败或被中断，统一走下面的退避重连
      }

      notifyStatus(false);
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
      notifyStatus(false);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
};
