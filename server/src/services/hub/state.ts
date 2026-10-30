/**
 * 中继（hub）的配置与运行态。
 *
 * 配置落 `$APP_HOME/app/service.json` 的 `relay` 字段：它与本机 `serviceToken` / 登录密码同一份 0600 文件，
 * 所以 `deviceToken` 与登录令牌同样明文存放（「读得到文件」就是本机身份证明，不必多一层哈希）。
 * 读写一律现读现写整份文件、不缓存副本：pid / host / port 由别的路径写同一个文件，缓存会让两边互相覆盖。
 * 运行态（连接与否、最近错误、重连次数）只在进程内存：重启后按配置重连，没有要持久化的东西。
 */
import { deployment } from "@ucode/brand/values";

import { env } from "../../env";
import {
  readServiceRegistration,
  writeServiceRegistration,
} from "../../platform/service-registration";

/** 中继配置：地址与设备绑定都由本机持有，中继侧只存设备令牌的哈希 */
export type HubConfig = {
  /** 用户是否开启中继 */
  enabled: boolean;
  /** 中继地址：本机覆盖优先，缺省取部署项 `deployment.hubUrl`；都为 null 表示这次交付没接入中继 */
  url: string | null;
  /** 设备 id（中继登记时分配） */
  deviceId: string | null;
  /** 设备令牌：隧道握手的凭证，中继侧只存哈希 */
  deviceToken: string | null;
  /** 登录会话令牌（调中继的设备接口用）；过期后重新登录 */
  token: string | null;
  /** 登录账号，界面展示「当前登录的是谁」 */
  username: string | null;
};

/** 局部更新：字段为 `undefined` 表示不动它，为 `null` 表示清空 */
export type HubConfigPatch = Partial<HubConfig>;

/** 中继运行态：状态接口与界面据此显示「连没连上、上次为什么失败」 */
export type HubRuntimeState = {
  /** 隧道是否已握手完成 */
  connected: boolean;
  /** 本次上线时刻（ISO）；未连接为 null */
  connectedAt: string | null;
  /** 最近一次失败原因（中文，供界面直接显示）；已连上时为 null */
  lastError: string | null;
  /** 已发起的重连次数；连上后归零 */
  reconnectAttempt: number;
};

const DISCONNECTED: HubRuntimeState = {
  connected: false,
  connectedAt: null,
  lastError: null,
  reconnectAttempt: 0,
};

/** 去掉末尾斜杠：地址要与固定路径拼接，留着会拼出 `//api/v1/...` */
const normalizeUrl = (url: string | null | undefined): string | null => {
  const trimmed = url?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
};

/**
 * 当前中继配置。地址的覆盖关系在这里收口：`service.json` 里的值优先，缺省回落到部署项。
 * 注册文件读不出来时按「未接入中继」处理，而不是抛错——它缺了别的东西也都跑不起来。
 */
export const getHubConfig = (): HubConfig => {
  const relay = readServiceRegistration(env.servicePath)?.relay;
  return {
    enabled: relay?.enabled ?? false,
    url: normalizeUrl(relay?.url) ?? normalizeUrl(deployment.hubUrl),
    deviceId: relay?.deviceId ?? null,
    deviceToken: relay?.deviceToken ?? null,
    token: relay?.token ?? null,
    username: relay?.username ?? null,
  };
};

const configListeners = new Set<(next: HubConfig, previous: HubConfig) => void>();

/** 订阅配置变化（中继客户端据此重连）；返回取消订阅 */
export const subscribeHubConfig = (
  listener: (next: HubConfig, previous: HubConfig) => void,
): (() => void) => {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
};

/** 局部更新中继配置并落盘，返回改动后的完整配置 */
export const saveHubConfig = (patch: HubConfigPatch): HubConfig => {
  const previous = getHubConfig();
  const registration = readServiceRegistration(env.servicePath);
  if (!registration) throw new Error("服务注册文件缺失或损坏，无法保存中继配置");

  const relay = registration.relay;
  writeServiceRegistration(env.servicePath, {
    ...registration,
    relay: {
      enabled: patch.enabled ?? relay.enabled,
      url: patch.url === undefined ? relay.url : normalizeUrl(patch.url),
      deviceId: patch.deviceId === undefined ? relay.deviceId : patch.deviceId,
      deviceToken: patch.deviceToken === undefined ? relay.deviceToken : patch.deviceToken,
      token: patch.token === undefined ? relay.token : patch.token,
      username: patch.username === undefined ? relay.username : patch.username,
    },
  });

  const next = getHubConfig();
  for (const listener of configListeners) listener(next, previous);
  return next;
};

/**
 * 解绑本机：清掉设备与登录凭证并停用中继。
 * 地址不在清理范围内——它是这次交付的部署项，退出登录不该把它一起抹掉。
 */
export const clearHubConfig = (): HubConfig =>
  saveHubConfig({
    enabled: false,
    deviceId: null,
    deviceToken: null,
    token: null,
    username: null,
  });

let runtimeState: HubRuntimeState = { ...DISCONNECTED };
const stateListeners = new Set<(state: HubRuntimeState) => void>();

export const getHubRuntimeState = (): HubRuntimeState => runtimeState;

/** 更新运行态并广播；四个字段都没变时不广播（重连期间每秒一次的重复状态没必要推给订阅者） */
export const setHubRuntimeState = (patch: Partial<HubRuntimeState>): HubRuntimeState => {
  const next = { ...runtimeState, ...patch };
  const unchanged =
    next.connected === runtimeState.connected &&
    next.connectedAt === runtimeState.connectedAt &&
    next.lastError === runtimeState.lastError &&
    next.reconnectAttempt === runtimeState.reconnectAttempt;
  runtimeState = next;
  if (unchanged) return next;

  for (const listener of stateListeners) listener(next);
  return next;
};

/** 订阅运行态（状态接口与界面据此更新）；返回取消订阅 */
export const subscribeHubState = (listener: (state: HubRuntimeState) => void): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};
