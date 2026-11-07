import type { HubRuntimePhase } from "@ucode/contracts";

/**
 * 中继（hub）的运行态：隧道当前处在哪一阶段、上次为什么失败。
 *
 * 只在进程内存：重启后按配置重连，没有要持久化的东西。阶段由隧道编排层显式写入
 * （不从「连接布尔 + 重连次数」反推——`halted` 反推不出来，那会让「永久停止」在界面上和「未接入」同屏）。
 */

/** 隧道阶段：契约的单一事实源（阶段语义见 `HubRuntimePhase` 的字段注释） */
export type HubTunnelPhase = HubRuntimePhase;

/** 中继运行态：状态接口与界面据此显示「连没连上、上次为什么失败、还能不能自己恢复」 */
export type HubRuntimeState = {
  /** 隧道所处阶段 */
  phase: HubTunnelPhase;
  /** 本次上线时刻（ISO）；未连接为 null */
  connectedAt: string | null;
  /** 最近一次失败原因（中文，供界面直接显示）；已连上时为 null */
  lastError: string | null;
  /** 已发起的重连次数；连上后归零 */
  reconnectAttempt: number;
};

const IDLE: HubRuntimeState = {
  phase: "idle",
  connectedAt: null,
  lastError: null,
  reconnectAttempt: 0,
};

let runtimeState: HubRuntimeState = { ...IDLE };
const listeners = new Set<(state: HubRuntimeState) => void>();

export const getHubRuntimeState = (): HubRuntimeState => runtimeState;

/** 更新运行态并广播；字段都没变时不广播（重连期间每秒一次的重复状态没必要推给订阅者） */
export const setHubRuntimeState = (patch: Partial<HubRuntimeState>): HubRuntimeState => {
  const next = { ...runtimeState, ...patch };
  const unchanged =
    next.phase === runtimeState.phase &&
    next.connectedAt === runtimeState.connectedAt &&
    next.lastError === runtimeState.lastError &&
    next.reconnectAttempt === runtimeState.reconnectAttempt;
  runtimeState = next;
  if (unchanged) return next;

  for (const listener of listeners) listener(next);
  return next;
};

/** 订阅运行态（状态接口与界面据此更新）；返回取消订阅 */
export const subscribeHubState = (listener: (state: HubRuntimeState) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
