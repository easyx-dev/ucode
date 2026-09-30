/** AgentSession 池：懒加载、同会话串行、空闲回收 */
import {
  type AgentSession,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_SESSION_MODE, ERROR_CODES, type WebsearchConfig } from "@ucode/contracts";

import type { SessionAllowStore } from "../agent/permissions";
import { buildSessionOptions, resolveSessionCwd } from "../agent/session-config";
import { cleanOrphanWorkspaces, ensureWorkspaceDir, workspaceDirOf } from "../agent/workspace";
import type { SessionRepository } from "../db/session-repository";
import { env } from "../env";
import { logger } from "../lib/logger";
import { AppError } from "../lib/response";
import type { SessionEventBus } from "./event-bus";
import type { InteractionBroker } from "./interactions";
import type { PiRuntime } from "./runtime";
import { indexFromManager } from "./session-index";

type PooledSession = {
  session: AgentSession;
  lastUsed: number;
};

/**
 * 内存中的 AgentSession 池。
 * 会话历史由 pi 持久化到 JSONL，这里只保留活跃进程状态，空闲后回收；
 * 列表与详情所需的索引字段由 `SessionRepository` 从 SQLite 直接读取。
 */
export class SessionPool {
  private readonly entries = new Map<string, PooledSession>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** 由本进程通过 HTTP 发起的、尚未结束的 run */
  private readonly running = new Set<string>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly runtime: PiRuntime,
    private readonly repository: SessionRepository,
    private readonly events: SessionEventBus,
    /** 联网搜索设置的实时读取（自研 websearch 工具用） */
    private readonly websearch: () => WebsearchConfig,
    /** 会话级权限状态：恒允记录与审批中转 */
    private readonly permissions: {
      allow: SessionAllowStore;
      interactions: InteractionBroker;
    },
  ) {}

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** 同一会话串行执行（流式生成期间到达的消息会排队） */
  withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(
      sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** 生成落定后回写索引（名称 / 条目数 / 预览 / 时间） */
  refreshIndex(sessionId: string): void {
    const session = this.entries.get(sessionId)?.session;
    if (!session) return;
    const index = indexFromManager(session.sessionManager);
    if (index) this.repository.refresh(sessionId, index);
  }

  async ensure(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.session;
    }

    const record = this.repository.find(sessionId);
    // 只为已存在的会话建实例：没有记录就没有可用的 cwd（见 run.ts 的同款前置检查）
    if (!record) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
        path: sessionId,
      });
    }
    const cwd = resolveSessionCwd(record);
    const mode = record.mode;

    // 只有未绑定目录的会话住工作区：它同时是这类会话的 cwd，跑之前必须存在；
    // 绑定目录的会话在用户自己的目录里干活，没有工作区这回事。
    // DB 行早于目录存在，孤儿清理的「无行即无主」据此成立
    if (cwd === workspaceDirOf(sessionId)) ensureWorkspaceDir(sessionId);

    const manager = record?.sourcePath
      ? SessionManager.open(record.sourcePath, env.sessionsRoot, cwd)
      : SessionManager.create(cwd, env.sessionsRoot, { id: sessionId });

    const { session } = await createAgentSession(
      await buildSessionOptions({
        record,
        cwd,
        mode,
        sessionManager: manager,
        runtime: this.runtime,
        websearch: this.websearch,
        permission: {
          listGrants: () => this.permissions.allow.list(sessionId),
          grant: (rule) => this.permissions.allow.add(sessionId, rule),
          request: (ask) => this.permissions.interactions.requestPermission(sessionId, ask),
        },
      }),
    );

    const entry: PooledSession = { session, lastUsed: Date.now() };
    this.entries.set(sessionId, entry);
    // 事件订阅常驻：会话池回收前，/events 的在线订阅者要靠它拿到实时事件；
    // 序号也不能随 detach 重置，否则重连的客户端会错判帧的新旧。
    this.events.attach(sessionId, session);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.entries.get(sessionId)?.session;
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /** 是否有活跃生成：池内占位的 run，或会话本身处于流式中 */
  isActive(sessionId: string): boolean {
    return this.isRunning(sessionId) || this.get(sessionId)?.isStreaming === true;
  }

  /**
   * 同步占位：返回 true 表示当前请求负责开启这一轮，false 表示已有 run 在跑。
   * 调用方必须在结束时 endRun()。用于避免并发 prompt() 竞争。
   */
  beginRun(sessionId: string): boolean {
    if (this.running.has(sessionId)) return false;
    this.running.add(sessionId);
    return true;
  }

  endRun(sessionId: string): void {
    this.running.delete(sessionId);
  }

  async abort(sessionId: string): Promise<boolean> {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    if (!entry.session.isStreaming) return false;
    await entry.session.abort();
    return true;
  }

  dispose(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    this.entries.delete(sessionId);
    this.locks.delete(sessionId);
    this.running.delete(sessionId);
    this.events.detach(sessionId);
    try {
      entry.session.dispose();
    } catch {
      // 忽略 dispose 异常
    }
    return true;
  }

  disposeAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.dispose(sessionId);
    }
  }

  hasActiveRun(): boolean {
    if (this.running.size > 0) return true;
    for (const entry of this.entries.values()) {
      if (entry.session.isStreaming) return true;
    }
    return false;
  }

  activeCount(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.entries) {
      if (entry.session.isStreaming) continue;
      if (this.running.has(sessionId)) continue;
      if (now - entry.lastUsed < env.poolIdleMs) continue;
      this.dispose(sessionId);
    }
    // 孤儿工作区：没有对应会话行的目录（对账删行、手工删库的漏网情形）
    const removed = cleanOrphanWorkspaces({ keepIds: this.repository.listIds() });
    if (removed.length > 0) {
      logger.debug({ removed }, "清理孤儿会话工作区");
    }
  }
}
