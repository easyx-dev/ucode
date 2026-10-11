/**
 * 配置服务：保存 patch 与手动重载。
 *
 * 两次保存 / 重载交错会让运行时切换与会话回收互相踩，所以在这里串行执行；
 * 重建顺序是「构建 → 落盘 → 切换 → 回收 → 广播」，构建失败时磁盘与内存都保持原状。
 */
import type { AppConfig, AppConfigPatchInput, ConfigSnapshot } from "@ucode/contracts";

import { classifyConfigChange } from "../../config/classify";
import { type ConfigStore, publicConfig } from "../../config/store";
import type { SessionEventBus } from "../../core/event-bus";
import type { SessionPool } from "../../core/pool";
import type { PiRuntime } from "../../harness/pi/runtime";

export type ConfigServiceDeps = {
  config: ConfigStore;
  runtime: PiRuntime;
  pool: SessionPool;
  events: SessionEventBus;
};

export type ConfigService = {
  /** 保存 patch：落盘 + 按需重建运行时，并把内存会话回收成「下次访问按新配置重装」 */
  applyConfig: (patch: AppConfigPatchInput) => Promise<void>;
  /** 用当前配置重建运行时（手动刷新模型目录） */
  reload: () => Promise<void>;
};

export const createConfigService = (deps: ConfigServiceDeps): ConfigService => {
  const { config, runtime, pool, events } = deps;

  const snapshot = (): ConfigSnapshot => ({
    config: publicConfig(config.get()),
    status: runtime.getStatus(),
  });

  const announceConfig = (): void => {
    events.emitControl({ type: "config_changed", config: snapshot() });
  };

  let applyChain: Promise<unknown> = Promise.resolve();
  const withApply = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = applyChain.then(fn, fn);
    applyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /**
   * 重建运行时并回收内存会话。构建（唯一可能失败的 await）与落盘都排在切换之前：
   * 失败时磁盘、运行时与内存会话都保持原状，不会留下「新配置 + 空运行时」的半截状态。
   */
  const swapRuntime = async (next: AppConfig, persist: boolean): Promise<void> => {
    runtime.assertUsable(next);
    const built = await runtime.build(next);
    if (persist) config.set(next);
    runtime.swap(built, next);
    pool.recycleForConfigChange();
    announceConfig();
  };

  return {
    applyConfig(patch: AppConfigPatchInput) {
      return withApply(async () => {
        // 先合并，再落盘：非法 patch 既不该丢内存会话，也不该写进 config.json
        const next = config.merge(patch);
        // 只有联网搜索是运行期读取：工具下次调用就用新设置，不必重建运行时与会话
        if (classifyConfigChange(next, config.get()) === "lazy") {
          config.set(next);
          announceConfig();
          return;
        }
        await swapRuntime(next, true);
      });
    },
    reload() {
      return withApply(() => swapRuntime(config.get(), false));
    },
  };
};
