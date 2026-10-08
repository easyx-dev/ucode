/**
 * 连接状态的主动校准：回到前台、网络恢复这两件事都意味着「这段时间可能什么都没收到」。
 *
 * 事件流自带空闲看门狗，但它靠定时器——后台标签页里被节流、窗口被冻住时根本不跑，
 * 而断开重连期间丢掉的增量也没有回放（事件不落盘）。所以这两类时机必须自己校准一次：
 * 重开连接（`client.events.restart`），由既有的重连路径按服务端快照补齐各 store，并丢掉已过期的积压增量。
 */
import { useEffect, useRef } from "react";

import { useClient } from "../provider";

/** 离开不足这个时长：连接不受可见性影响，什么都不可能丢，不为此付一次重连与快照 */
const MIN_AWAY_MS = 30_000;

/**
 * @param hasActiveRun 客户端是否认为有会话正在生成（含压缩）：回到前台时唯一会卡在「工作中」的状态，
 *   没有它就不必校准；网络恢复不看这个——断网期间的增量一律不可信
 */
export function useConnectionResync(hasActiveRun: boolean): void {
  const client = useClient();
  // 监听只注册一次：生成态在一轮里反复变化，跟着重建监听会丢掉「什么时候被挂到后台」
  const activeRef = useRef(hasActiveRun);
  activeRef.current = hasActiveRun;

  useEffect(() => {
    let hiddenSince = document.hidden ? Date.now() : null;

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        hiddenSince = Date.now();
        return;
      }
      const away = hiddenSince === null ? 0 : Date.now() - hiddenSince;
      hiddenSince = null;
      if (away < MIN_AWAY_MS || !activeRef.current) return;
      client.events.restart();
    };

    // 离线期间不做处理：重连会照常退避重试，恢复后自己接上；这里只管恢复之后可能已经半死的连接
    const onOnline = (): void => client.events.restart();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [client]);
}
