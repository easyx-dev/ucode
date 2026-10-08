/**
 * 回到前台时的状态校准：后台期间事件流可能半死，而看门狗靠定时器——后台被节流、窗口被冻结时它根本不跑，
 * 界面就一直停在本轮最后的状态（如「工作中」），只能刷新才收敛。
 *
 * 校准方式是重开一次事件流（`client.events.restart`）：既有的重连路径本来就会按服务端快照补齐各 store，
 * 同时丢掉后台积压的旧帧——直接补快照比逐帧补放可靠，旧帧按次序落在新快照上也不成立。
 */
import { useEffect, useRef } from "react";

import { useClient } from "../provider";

/** 离开不足这个时长：连接不受可见性影响，什么都不可能丢，不为此付一次重连与快照 */
const MIN_AWAY_MS = 30_000;

/**
 * @param hasActiveRun 客户端是否认为有会话正在生成（含压缩）：唯一会卡在「工作中」的状态，
 *   没有它就不必校准
 */
export function useForegroundResync(hasActiveRun: boolean): void {
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

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [client]);
}
