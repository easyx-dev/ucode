/**
 * 全局事件流：持有单条 SSE 连接并按指数退避重连，向订阅者广播帧与连接状态。
 *
 * 连接与重连的循环在 `reconnect.ts`（终端输出流共用同一套）；这里只管事件流特有的分发：
 * `server.connected` 作为连接信号只触发 `onConnected`，不进入 `onEvent`；错误帧同时进入
 * `onEvent` 与 `onError`。
 */
import type { ServerEvent } from "@ucode/contracts";

import { type ApiError, toApiError } from "./error";
import { createReconnectingStream, type StreamConnect } from "./reconnect";

export type EventConnect = StreamConnect<ServerEvent>;

export type EventStream = {
  /** 建立连接；重复调用无副作用 */
  start: () => void;
  /** 断开连接并停止重连 */
  stop: () => void;
  /**
   * 重开连接：丢掉积压的旧帧，走既有的「重连 → 按服务端快照收敛」路径。
   * 用于连接可能已半死、积压的增量又已过期的场合（如页面从后台回到前台）。
   */
  restart: () => void;
  /** 订阅所有帧（不含 `server.connected`），返回退订函数 */
  onEvent: (listener: (frame: ServerEvent) => void) => () => void;
  /** 订阅错误帧，返回退订函数 */
  onError: (listener: (error: ApiError) => void) => () => void;
  /** 订阅连接建立，返回退订函数 */
  onConnected: (listener: () => void) => () => void;
  /** 订阅连接断开，返回退订函数 */
  onDisconnected: (listener: () => void) => () => void;
};

export const createEventStream = (connect: EventConnect): EventStream => {
  const eventListeners = new Set<(frame: ServerEvent) => void>();
  const errorListeners = new Set<(error: ApiError) => void>();
  const connectedListeners = new Set<() => void>();
  const disconnectedListeners = new Set<() => void>();

  const stream = createReconnectingStream<ServerEvent>({
    connect,
    isOpenFrame: (frame) => frame.type === "server.connected",
  });

  stream.onFrame((frame) => {
    if (frame.type === "server.connected") return;
    for (const listener of eventListeners) listener(frame);
    if (frame.type === "error") {
      const error = toApiError(frame);
      for (const listener of errorListeners) listener(error);
    }
  });
  stream.onOpen(() => {
    for (const listener of connectedListeners) listener();
  });
  stream.onClosed(() => {
    for (const listener of disconnectedListeners) listener();
  });

  return {
    start: stream.start,
    stop: stream.stop,
    restart: stream.restart,
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
