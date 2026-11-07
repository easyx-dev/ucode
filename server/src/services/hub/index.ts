/**
 * 中继（hub）客户端门面：登录、解绑、状态查询，以及把中继的模型端点写成本机 provider。
 *
 * 隧道生命周期不在这里编排：配置一变（登录写回 `service.json`、退出清空）就由隧道自己的
 * `subscribeHubConfig` 重建（它按字段过滤，只重启真正要重连的那些），因此门面只负责
 * 「把凭证落到本机」与「解绑时顺手吊销中继侧设备」这两件事本身。
 */
import { hostname } from "node:os";

import type { AppConfigPatchInput, HubProviderResponse, ProviderConfig } from "@ucode/contracts";

import { logger } from "../../platform/logger";
import { serviceVersion } from "../../platform/version";
import { hubLogin, hubRegisterDevice, hubRevokeDevice } from "./client";
import { clearHubConfig, getHubConfig, saveHubConfig } from "./config";
import { resolveEndpoint } from "./endpoint";
import { createHubProviderInjector } from "./provider";
import { getHubRuntimeState } from "./runtime";
import { createHubTunnel } from "./tunnel";

export type { HubDevice } from "./client";
export type { HubConfig } from "./config";
export { getHubConfig } from "./config";
export type { HubRuntimeState } from "./runtime";
export { getHubRuntimeState, subscribeHubState } from "./runtime";

/** 对外状态：界面据此显示「接了哪台中继、登的谁、隧道通没通」 */
export type HubStatus = {
  /** 地址与设备令牌齐备，具备连隧道的条件 */
  configured: boolean;
  url: string | null;
  username: string | null;
  deviceId: string | null;
  /** 本机主机名：登记设备时用的名字，界面展示用 */
  deviceName: string | null;
  /** 当前是否持有隧道连接 */
  running: boolean;
  runtime: ReturnType<typeof getHubRuntimeState>;
};

export type HubService = {
  /** 随服务启动：按现有配置尝试连隧道 */
  start(): void;
  /** 随服务退出：断开且不再重连 */
  stop(): void;
  getStatus(): HubStatus;
  /** 登录中继并把本机登记为设备（同名设备在中继侧轮换令牌） */
  login(input: {
    url?: string;
    username: string;
    password: string;
    deviceName?: string;
  }): Promise<HubStatus>;
  /** 解绑本机：清掉设备与登录凭证并断开隧道（保留地址这一部署项） */
  logout(): HubStatus;
  /** 把中继的模型端点写成本机的普通 provider（固定 id `relay`；重复调用只刷新模型清单） */
  addProvider(): Promise<HubProviderResponse>;
};

/** 写中继 provider 要用到的配置读写：读当前清单判幂等，写入走服务层的 applyConfig */
export type HubServiceDeps = {
  getProviders: () => ProviderConfig[];
  applyConfig: (patch: AppConfigPatchInput) => Promise<void>;
};

export const createHubService = (deps: HubServiceDeps): HubService => {
  const tunnel = createHubTunnel();
  const provider = createHubProviderInjector(deps);

  /**
   * 尽力吊销中继侧设备：中继已经不认这份凭证就罢了，连不上也只记日志——
   * 本机侧的解绑不能被中继的可用性拖住（否则中继一挂，用户就退不出来）。
   */
  const revokeOnHub = async (config: ReturnType<typeof getHubConfig>): Promise<void> => {
    const { url, token, deviceId } = config;
    if (!url || !token || !deviceId) return;
    try {
      await hubRevokeDevice(url, token, deviceId);
      logger.info({ url, deviceId }, "已吊销中继上的本机设备");
    } catch (error) {
      logger.warn(
        { url, deviceId, error: error instanceof Error ? error.message : String(error) },
        "吊销中继设备失败（本机已解绑，可在中继后台手工吊销）",
      );
    }
  };

  const statusOf = (): HubStatus => {
    const config = getHubConfig();
    return {
      // 与「能不能连」同源：地址与设备令牌齐备即可，设备 id 只用于日志
      configured: resolveEndpoint(config).kind === "ready",
      url: config.url,
      username: config.username,
      deviceId: config.deviceId,
      deviceName: hostname(),
      running: tunnel.isRunning(),
      runtime: getHubRuntimeState(),
    };
  };

  return {
    start() {
      tunnel.start();
    },
    stop() {
      tunnel.stop();
    },
    getStatus: statusOf,

    async login(input) {
      const url = (input.url ?? getHubConfig().url ?? "").trim();
      if (!url) throw new Error("未配置中继地址：请填写中继服务地址后再登录");

      const session = await hubLogin(url, { username: input.username, password: input.password });
      const registered = await hubRegisterDevice(url, session.token, {
        name: input.deviceName?.trim() || hostname(),
        platform: process.platform,
        clientVersion: serviceVersion,
      });

      saveHubConfig({
        enabled: true,
        url,
        token: session.token,
        username: session.user.username,
        deviceId: registered.device.id,
        deviceToken: registered.token,
      });
      logger.info(
        { url, deviceId: registered.device.id, username: session.user.username },
        "已登录中继并登记本机设备",
      );
      return statusOf();
    },

    logout() {
      // 先取旧配置再清：吊销要用里面的登录令牌与设备 id（清掉之后就拿不到了）
      const previous = getHubConfig();
      clearHubConfig();
      void revokeOnHub(previous);
      logger.info("已退出中继：本机设备绑定与登录凭证已清除");
      return statusOf();
    },

    async addProvider() {
      const config = getHubConfig();
      const result = await provider.add({ url: config.url, deviceToken: config.deviceToken });
      logger.info(
        { providerId: result.providerId, baseUrl: result.baseUrl, models: result.models.length },
        "已把中继模型端点写入本机 provider",
      );
      return result;
    },
  };
};
