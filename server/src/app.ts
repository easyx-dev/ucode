/** 服务装配：配置、ModelRuntime、会话池，以及配置热重载的编排 */
import type { AppConfigPatch } from "./config/schema";
import { SessionStateStore } from "./config/session-state";
import { ConfigStore } from "./config/store";
import { AppError } from "./lib/result";
import { SessionPool } from "./pi/pool";
import { PiRuntime } from "./pi/runtime";

export type Services = {
  config: ConfigStore;
  sessionState: SessionStateStore;
  runtime: PiRuntime;
  pool: SessionPool;
  /** 更新配置：落盘 + 重建 ModelRuntime + 丢弃内存中的 AgentSession */
  applyConfig(patch: AppConfigPatch): Promise<void>;
  /** 用当前配置重建运行时 */
  reload(): Promise<void>;
};

export const createServices = async (): Promise<Services> => {
  const config = new ConfigStore();
  const sessionState = new SessionStateStore();
  const runtime = new PiRuntime();
  const pool = new SessionPool(runtime, sessionState);

  config.load();
  sessionState.load();
  await runtime.apply(config.get());
  pool.startSweeper();

  const guardIdle = (): void => {
    if (pool.hasActiveRun()) {
      throw new AppError("session_busy", "有会话正在生成，请先中断再更新配置", 409);
    }
  };

  return {
    config,
    sessionState,
    runtime,
    pool,
    async applyConfig(patch: AppConfigPatch) {
      guardIdle();
      // 先校验并落盘，避免 patch 非法时白白丢掉内存会话
      const next = config.update(patch);
      pool.disposeAll();
      await runtime.apply(next);
    },
    async reload() {
      guardIdle();
      pool.disposeAll();
      await runtime.apply(config.get());
    },
  };
};
