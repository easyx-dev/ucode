/**
 * 服务生命周期：启动对账、定时清理与退出收尾。
 *
 * 这些是进程级的事（跑一次的对账、两个 interval、关连接），与「装配出哪些对象」不是一回事，
 * 所以从装配里拆出来单列。
 */
import type { DatabaseSync } from "node:sqlite";

import type { ConfigStore } from "../../config/store";
import { ATTACHMENT_SWEEP_INTERVAL_MS, ATTACHMENT_TEMP_TTL_MS } from "../../constants/attachments";
import { AUTH_SWEEP_INTERVAL_MS } from "../../constants/auth";
import type { SessionPool } from "../../core/pool";
import type { AttachmentRepository } from "../../db/attachment-repository";
import type { SessionRepository } from "../../db/session-repository";
import { expireTempAttachments } from "../../harness/features/attachment";
import type { PiRuntime } from "../../harness/pi/runtime";
import { logger } from "../../platform/logger";
import type { PairingStore } from "../auth/pairing";
import type { RateLimiter } from "../auth/rate-limit";
import type { SessionService } from "../auth/sessions";
import type { ProjectService } from "../projects";

export type LifecycleDeps = {
  /** 单进程单连接：关闭由这里统一负责 */
  db: DatabaseSync;
  config: ConfigStore;
  runtime: PiRuntime;
  pool: SessionPool;
  sessions: SessionRepository;
  attachments: AttachmentRepository;
  projects: ProjectService;
  auth: {
    sessions: SessionService;
    pairing: PairingStore;
    loginLimiter: RateLimiter;
  };
};

export type ServiceLifecycle = {
  /** 启动对账与定时清理；清理失败不影响服务可用 */
  start: () => Promise<void>;
  /** 停定时器并关闭共享连接；重复调用只生效一次 */
  stop: () => void;
};

export const createLifecycle = (deps: LifecycleDeps): ServiceLifecycle => {
  const {
    db,
    config,
    runtime,
    pool,
    sessions,
    attachments,
    projects,
    auth: { sessions: authSessions, pairing, loginLimiter },
  } = deps;

  let attachmentSweeper: NodeJS.Timeout | undefined;
  let authSweeper: NodeJS.Timeout | undefined;
  // 退出时可能先后收到多个信号，stop 只能生效一次（DatabaseSync 重复 close 会抛）
  let stopped = false;

  const sweepAttachments = (): void => {
    try {
      const before = new Date(Date.now() - ATTACHMENT_TEMP_TTL_MS).toISOString();
      expireTempAttachments({ repo: attachments }, before);
    } catch (error) {
      logger.warn(`清理过期附件失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sweepAuth = (): void => {
    try {
      authSessions.prune();
      pairing.prune();
      loginLimiter.prune();
    } catch (error) {
      logger.warn(`清理鉴权内存态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    async start(): Promise<void> {
      config.load();
      // 以 JSONL 为准对齐索引：清理文件已消失的行
      await sessions.reconcile();
      // 项目行以会话为「主」：上一个跑完的对账可能已经删掉了某些会话，这里一并清掉无主的项目行
      const prunedProjects = projects.reconcile(sessions.listCwds());
      if (prunedProjects.length > 0) {
        logger.info({ paths: prunedProjects }, "清理无主项目行");
      }
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

      sweepAttachments();
      attachmentSweeper = setInterval(sweepAttachments, ATTACHMENT_SWEEP_INTERVAL_MS);
      attachmentSweeper.unref();

      sweepAuth();
      authSweeper = setInterval(sweepAuth, AUTH_SWEEP_INTERVAL_MS);
      authSweeper.unref();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (attachmentSweeper) clearInterval(attachmentSweeper);
      if (authSweeper) clearInterval(authSweeper);
      db.close();
    },
  };
};
