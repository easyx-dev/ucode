/**
 * 内置资产的云端下发（服务层胶水）：把中继配置读出来交给 harness 的拉取过程。
 *
 * 触发点有两个：服务启动，以及中继配置变化（登录成功、改地址）。都不阻塞装配——
 * 拉取全程 fire-and-forget，成功失败只记日志与诊断（中继不可达只是「拿不到更新」，
 * 见 plans/hub.md「内置资产云同步」）。
 */
import { env } from "../../env";
import { pullCloudBuiltinAssets } from "../../harness/plugins/builtin/cloud";
import { logger } from "../../platform/logger";
import { getHubConfig, subscribeHubConfig } from "../hub/config";

const MODULE = "plugins.builtin";

/** 拉一次；未接入中继时内部直接返回，不发请求也不报诊断 */
const syncFromHubConfig = (): void => {
  const config = getHubConfig();
  if (!config.enabled) return;

  const diagnostics: string[] = [];
  void pullCloudBuiltinAssets({
    hubUrl: config.url,
    deviceToken: config.deviceToken,
    builtinDir: env.builtinDir,
    onDiagnostic: (message) => diagnostics.push(message),
  }).then((result) => {
    // 诊断攒到一次日志里输出：逐条 warn 会把启动日志淹掉，而这里的信息是同一件事的分解
    if (diagnostics.length > 0) {
      logger.warn({ module: MODULE, diagnostics, applied: result.applied }, "内置资产云同步有诊断");
    }
    if (result.applied.length > 0) {
      logger.info(
        {
          module: MODULE,
          applied: result.applied,
          quarantined: result.quarantined,
          skipped: result.skipped,
        },
        "内置资产已更新",
      );
    }
  });
};

/** 随服务启动调用一次；同时订阅中继配置，登录后不用等下次重启才拿到更新 */
export const startBuiltinCloudSync = (): void => {
  subscribeHubConfig(() => syncFromHubConfig());
  syncFromHubConfig();
};
