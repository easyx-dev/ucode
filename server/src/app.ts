/** 服务装配：配置、ModelRuntime、会话仓储与池，以及配置热重载的编排 */
import type { AppConfigPatch } from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import { ConfigStore } from "./config/store";
import { SessionEventBus } from "./core/event-bus";
import { SessionPool } from "./core/pool";
import { PiRuntime } from "./core/runtime";
import { SessionRepository } from "./db/session-repository";
import { AppError } from "./lib/response";

export type Services = {
  config: ConfigStore;
  /** 会话元数据与索引（SQLite） */
  sessions: SessionRepository;
  runtime: PiRuntime;
  pool: SessionPool;
  /** 会话事件总线：/events 的唯一数据源 */
  events: SessionEventBus;
  /** 更新配置：落盘 + 重建 ModelRuntime + 丢弃内存中的 AgentSession */
  applyConfig(patch: AppConfigPatch): Promise<void>;
  /** 用当前配置重建运行时 */
  reload(): Promise<void>;
};

export const createServices = async (): Promise<Services> => {
  const config = new ConfigStore();
  const sessions = new SessionRepository();
  const runtime = new PiRuntime();
  const events = new SessionEventBus();
  const pool = new SessionPool(runtime, sessions, events);

  config.load();
  // 以 JSONL 为准对齐索引：补齐外部新增、清理文件已消失的行
  await sessions.reconcile();
  await runtime.apply(config.get());
  pool.startSweeper();

  const guardIdle = (): void => {
    if (pool.hasActiveRun()) {
      throw new AppError(ERROR_CODES.sessionBusy, "有会话正在生成，请先中断再更新配置", 409);
    }
  };

  return {
    config,
    sessions,
    runtime,
    pool,
    events,
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
