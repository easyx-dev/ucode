/**
 * 流式连接的重连与看门狗：把「连上 → 断开 → 退避重连」这段循环收在一处，
 * 各域（当前是全局事件流；浏览器面板的帧流将来照它做）只提供「连一次」的实现与
 * 「哪一帧代表连上了」的判定。
 *
 * 看门狗不是多余：TCP 半死的连接既不 reject 也不结束，没有它就会一直停在「已连接」。
 * 服务端每 15s 一次心跳，三倍余量即 45s 判死。
 */
import type { ApiError } from "./error";

/** 建立一次连接；返回即表示这次连接结束（对端收流、出错或被中断） */
export type StreamConnect<TFrame> = (
  onFrame: (frame: TFrame) => void,
  signal: AbortSignal,
  /** 每读到一段数据（含 `: heartbeat` 注释行）时回调：看门狗靠它区分「安静」与「半死」 */
  onActivity: () => void,
) => Promise<void>;

export type ReconnectingStreamOptions<TFrame> = {
  connect: StreamConnect<TFrame>;
  /** 哪一帧代表这条连接真的通上了：到达即置为已连接并清零退避 */
  isOpenFrame: (frame: TFrame) => boolean;
};

export type ReconnectingStream<TFrame> = {
  /** 建立连接；重复调用无副作用 */
  start: () => void;
  /** 断开连接并停止重连 */
  stop: () => void;
  /** 换一条新连接：丢掉积压的旧帧，走既有的「重连 → 按服务端快照收敛」路径 */
  restart: () => void;
  /** 订阅所有帧（含连接信号那类帧，由调用方自己过滤） */
  onFrame: (listener: (frame: TFrame) => void) => () => void;
  /** 订阅连接建立（每次重连成功都会再触发） */
  onOpen: (listener: () => void) => () => void;
  /** 订阅连接断开 */
  onClosed: (listener: () => void) => () => void;
};

/** 连接空闲多久算半死；服务端 15s 一次心跳，取三倍余量 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

/** 退避上限：断网时不必无限拉长，恢复后要能立刻重连 */
const RECONNECT_MAX_DELAY_MS = 10_000;

/** 错误帧在调用方处理，这里只透传；导出类型名是为了让调用方的签名写全 */
export type StreamError = ApiError;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createReconnectingStream = <TFrame>(
  options: ReconnectingStreamOptions<TFrame>,
): ReconnectingStream<TFrame> => {
  const frameListeners = new Set<(frame: TFrame) => void>();
  const openListeners = new Set<() => void>();
  const closedListeners = new Set<() => void>();

  let controller: AbortController | null = null;
  let connected = false;
  let attempt = 0;

  const notifyOpen = (): void => {
    if (connected) return;
    connected = true;
    for (const listener of openListeners) listener();
  };

  const notifyClosed = (): void => {
    if (!connected) return;
    connected = false;
    for (const listener of closedListeners) listener();
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
        await options.connect(
          (frame) => {
            lastActivityAt = Date.now();
            if (options.isOpenFrame(frame)) {
              attempt = 0;
              notifyOpen();
            }
            for (const listener of frameListeners) listener(frame);
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

      notifyClosed();
      if (current.signal.aborted) return;

      attempt += 1;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS));
      // 退避期间若被 stop（或 stop 后重启）替换了 controller，本次循环退出，避免两条连接并存
      if (controller !== current) return;
    }
  };

  const start = (): void => {
    if (controller) return;
    controller = new AbortController();
    void run();
  };

  const stop = (): void => {
    controller?.abort();
    controller = null;
    attempt = 0;
    notifyClosed();
  };

  return {
    start,
    stop,
    restart() {
      // 没在连就不动：起停由生命周期决定，这里只负责换一条新连接
      if (!controller) return;
      stop();
      start();
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    onOpen(listener) {
      openListeners.add(listener);
      return () => {
        openListeners.delete(listener);
      };
    },
    onClosed(listener) {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    },
  };
};
