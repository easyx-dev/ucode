/** 服务装配：配置、ModelRuntime、会话仓储与池，以及配置应用（热重载）的编排 */
import type { AppConfig, AppConfigPatchInput, ConfigSnapshot } from "@ucode/contracts";
import { classifyConfigChange } from "./config/classify";
import { ConfigStore, publicConfig } from "./config/store";
import {
  ATTACHMENT_SWEEP_INTERVAL_MS,
  ATTACHMENT_TEMP_TTL_MS,
  AUTH_SWEEP_INTERVAL_MS,
} from "./constants";
import { SessionEventBus } from "./core/event-bus";
import { InteractionBroker } from "./core/interactions";
import { SessionPool } from "./core/pool";
import { PiRuntime } from "./core/runtime";
import { openDatabase } from "./db";
import { AttachmentRepository } from "./db/attachment-repository";
import { AuthSessionRepository } from "./db/auth-session-repository";
import { SessionRepository } from "./db/session-repository";
import { env } from "./env";
import { expireTempAttachments } from "./harness/attachment";
import { contextBudgetOf } from "./harness/budget";
import { GoalService } from "./harness/goal";
import { MemoryService } from "./harness/memory";
import { SessionAllowStore } from "./harness/permissions";
import { TitleService } from "./harness/title";
import { UsageService } from "./harness/usage";
import { CredentialStore } from "./lib/auth/credentials";
import { PairingStore } from "./lib/auth/pairing";
import { RateLimiter } from "./lib/auth/rate-limit";
import { SessionService } from "./lib/auth/sessions";
import { logger } from "./lib/logger";
import type { ServiceRegistration } from "./lib/service-file";

export type Services = {
  config: ConfigStore;
  /** 会话元数据与索引（SQLite） */
  sessions: SessionRepository;
  /** 附件元数据（SQLite）；字节在 `$APP_HOME/app/attachments` */
  attachments: AttachmentRepository;
  runtime: PiRuntime;
  pool: SessionPool;
  /** 会话事件总线：/events 的唯一数据源 */
  events: SessionEventBus;
  /** 交互中转：权限审批等「服务端提问、前端回答」的挂起请求 */
  interactions: InteractionBroker;
  /** 会话级权限状态：审批弹窗里的「本会话恒允」 */
  permissions: SessionAllowStore;
  /** 使用统计：从会话记录聚合 token 用量，不落库 */
  usage: UsageService;
  /** 目标模式：会话目标状态与落定后的校验续跑 */
  goals: GoalService;
  /** 会话标题：首条消息得到回复后自动起名 */
  titles: TitleService;
  /** 鉴权：凭证、登录会话、一次性配对码与登录限流 */
  auth: {
    credentials: CredentialStore;
    sessions: SessionService;
    pairing: PairingStore;
    loginLimiter: RateLimiter;
    /** 服务注册信息（host / port 等）；端口自选时 index 会在监听后回写同一个对象 */
    registration: ServiceRegistration;
  };
  /** 更新配置：落盘 + 按需重建 ModelRuntime，并把内存会话回收成「下次访问按新配置重装」 */
  applyConfig(patch: AppConfigPatchInput): Promise<void>;
  /** 用当前配置重建运行时（手动刷新模型目录） */
  reload(): Promise<void>;
  /** 关闭共享的 SQLite 连接 */
  close(): void;
};

export const createServices = async (registration: ServiceRegistration): Promise<Services> => {
  // 单进程单连接：两个仓储共用同一个句柄，关闭也由这里统一负责
  const db = openDatabase();
  const config = new ConfigStore();
  const sessions = new SessionRepository(db);
  const attachments = new AttachmentRepository(db);
  const authSessions = new SessionService(new AuthSessionRepository(db));
  const credentials = new CredentialStore(registration, env.servicePath);
  const pairing = new PairingStore();
  const loginLimiter = new RateLimiter();
  const runtime = new PiRuntime();
  const events = new SessionEventBus();
  const interactions = new InteractionBroker(events);
  const permissions = new SessionAllowStore();
  const usage = new UsageService(
    sessions,
    (ref) => runtime.contextWindowOf(ref),
    // 触发点与装配层注入 pi 的阈值同源：界面显示的「预算」就是实际会压缩的那个数
    (ref) => {
      const contextWindow = runtime.contextWindowOf(ref);
      if (!contextWindow) return null;
      return contextBudgetOf({
        contextWindow,
        override: runtime.contextBudgetOf(ref),
      }).triggerTokens;
    },
  );
  const memory = new MemoryService(() => config.get().memory);
  const goals = new GoalService(sessions, usage, events);
  const pool = new SessionPool(
    runtime,
    sessions,
    events,
    () => config.get().websearch,
    {
      allow: permissions,
      interactions,
    },
    memory,
    goals,
    usage,
  );
  // 标题在池之后装配：它订阅总线的 `agent_settled`，并借池拿到池内会话
  const titles = new TitleService({
    sessions,
    events,
    liveOf: (sessionId) => pool.get(sessionId),
    emitSummary: (sessionId) => pool.refreshSummary(sessionId),
  });

  config.load();
  // 以 JSONL 为准对齐索引：清理文件已消失的行
  await sessions.reconcile();
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

  // 草稿临时附件过期清理：只在草稿里引用过、从未随消息发送的附件按 TTL 回收
  const sweepAttachments = (): void => {
    try {
      const before = new Date(Date.now() - ATTACHMENT_TEMP_TTL_MS).toISOString();
      expireTempAttachments({ repo: attachments }, before);
    } catch (error) {
      logger.warn(`清理过期附件失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  sweepAttachments();
  const attachmentSweeper = setInterval(sweepAttachments, ATTACHMENT_SWEEP_INTERVAL_MS);
  attachmentSweeper.unref();

  // 鉴权内存态清理：过期会话行、过期配对码与限流窗口；都只是回收，失败不阻断服务
  const sweepAuth = (): void => {
    try {
      authSessions.prune();
      pairing.prune();
      loginLimiter.prune();
    } catch (error) {
      logger.warn(`清理鉴权内存态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  sweepAuth();
  const authSweeper = setInterval(sweepAuth, AUTH_SWEEP_INTERVAL_MS);
  authSweeper.unref();

  // 退出时可能先后收到多个信号，close 只能生效一次（DatabaseSync 重复 close 会抛）
  let closed = false;

  const snapshot = (): ConfigSnapshot => ({
    config: publicConfig(config.get()),
    status: runtime.getStatus(),
  });

  const announceConfig = (): void => {
    events.emitControl({ type: "config_changed", config: snapshot() });
  };

  // 两次保存 / 重载交错会让运行时切换与会话回收互相踩，串行执行
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
    config,
    sessions,
    attachments,
    runtime,
    pool,
    events,
    interactions,
    permissions,
    usage,
    goals,
    titles,
    auth: {
      credentials,
      sessions: authSessions,
      pairing,
      loginLimiter,
      registration,
    },
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
    close() {
      if (closed) return;
      closed = true;
      clearInterval(attachmentSweeper);
      clearInterval(authSweeper);
      db.close();
    },
  };
};
