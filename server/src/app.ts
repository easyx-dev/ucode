/** 服务装配：配置、ModelRuntime、会话仓储与池，以及配置热重载的编排 */
import type { AppConfigPatchInput } from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import { ConfigStore } from "./config/store";
import { SessionEventBus } from "./core/event-bus";
import { SessionPool } from "./core/pool";
import { PiRuntime } from "./core/runtime";
import { openDatabase } from "./db";
import { ProjectRepository } from "./db/project-repository";
import { SessionRepository } from "./db/session-repository";
import { env } from "./env";
import { logger } from "./lib/logger";
import { AppError } from "./lib/response";

export type Services = {
  config: ConfigStore;
  /** 会话元数据与索引（SQLite） */
  sessions: SessionRepository;
  /** 项目空间：用户登记的目录集合，供会话分组 */
  projects: ProjectRepository;
  runtime: PiRuntime;
  pool: SessionPool;
  /** 会话事件总线：/events 的唯一数据源 */
  events: SessionEventBus;
  /** 更新配置：落盘 + 重建 ModelRuntime + 丢弃内存中的 AgentSession */
  applyConfig(patch: AppConfigPatchInput): Promise<void>;
  /** 用当前配置重建运行时 */
  reload(): Promise<void>;
  /** 关闭共享的 SQLite 连接 */
  close(): void;
};

export const createServices = async (): Promise<Services> => {
  // 单进程单连接：两个仓储共用同一个句柄，关闭也由这里统一负责
  const db = openDatabase();
  const config = new ConfigStore();
  const sessions = new SessionRepository(db);
  const projects = new ProjectRepository(db);
  const runtime = new PiRuntime();
  const events = new SessionEventBus();
  const pool = new SessionPool(runtime, sessions, events, () => config.get().websearch);

  config.load();
  // 以 JSONL 为准对齐索引：补齐外部新增、清理文件已消失的行
  await sessions.reconcile();
  // 启动时没有活跃会话，过期草稿无需豁免
  sessions.deleteStaleDrafts(new Date(Date.now() - env.draftTtlMs).toISOString());
  await runtime.apply(config.get());
  // 内置 provider 集合要在首次 apply 之后才拿到，所以这里才能判断条目是否可落地；
  // 手改 config.json 留下的坏条目会被 pi 静默忽略，至少让它可见（不阻断启动）
  try {
    runtime.assertUsable(config.get());
  } catch (error) {
    logger.warn(
      `配置里有无法落地的 provider（会被忽略）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  pool.startSweeper();

  const guardIdle = (): void => {
    if (pool.hasActiveRun()) {
      throw new AppError(ERROR_CODES.sessionBusy, "有会话正在生成，请先中断再更新配置", 409);
    }
  };

  // 退出时可能先后收到多个信号，close 只能生效一次（DatabaseSync 重复 close 会抛）
  let closed = false;

  return {
    config,
    sessions,
    projects,
    runtime,
    pool,
    events,
    async applyConfig(patch: AppConfigPatchInput) {
      guardIdle();
      // 先合并并校验，再落盘：非法 patch 既不该丢内存会话，也不该写进 config.json
      const next = config.merge(patch);
      runtime.assertUsable(next);
      config.set(next);
      pool.disposeAll();
      await runtime.apply(next);
    },
    async reload() {
      guardIdle();
      const next = config.get();
      runtime.assertUsable(next);
      pool.disposeAll();
      await runtime.apply(next);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
};
