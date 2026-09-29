/** 全局事件流：单例连接 + 指数退避重连；React 侧只订阅，不关心连接细节 */
import type { ServerEvent } from "@ucode/contracts";

import { api } from "@/lib/api";

type FrameListener = (frame: ServerEvent) => void;
type StatusListener = (connected: boolean) => void;

const listeners = new Set<FrameListener>();
const statusListeners = new Set<StatusListener>();

let controller: AbortController | null = null;
let started = false;
let connected = false;
let attempt = 0;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const notifyStatus = (next: boolean): void => {
  if (connected === next) return;
  connected = next;
  for (const listener of statusListeners) listener(next);
};

const run = async (): Promise<void> => {
  while (controller && !controller.signal.aborted) {
    const current = controller;
    try {
      await api.events.subscribe((frame) => {
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
  }
};

export const eventStream = {
  /** 应用级启动；重复调用无副作用 */
  start(): void {
    if (started) return;
    started = true;
    controller = new AbortController();
    void run();
  },
  subscribe(listener: FrameListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onStatus(listener: StatusListener): () => void {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  },
};
