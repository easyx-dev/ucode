import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

import type { SessionStateStore } from "../config/session-state";
import { env } from "../env";
import type { PiRuntime } from "./runtime";

type PooledSession = {
  session: AgentSession;
  lastUsed: number;
};

/**
 * 内存中的 AgentSession 池。
 * 会话历史由 pi 持久化到 JSONL，这里只保留活跃进程状态，空闲后回收。
 */
export class SessionPool {
  private readonly entries = new Map<string, PooledSession>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** 由本进程通过 HTTP 发起的、尚未结束的 run */
  private readonly running = new Set<string>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly runtime: PiRuntime,
    private readonly sessionState: SessionStateStore,
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

  async findInfo(sessionId: string): Promise<SessionInfo | undefined> {
    const sessions = await SessionManager.listAll(env.sessionsRoot);
    return sessions.find((info) => info.id === sessionId);
  }

  async listInfos(): Promise<SessionInfo[]> {
    return SessionManager.listAll(env.sessionsRoot);
  }

  async ensure(sessionId: string, cwdOverride?: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.session;
    }

    const info = await this.findInfo(sessionId);
    const override = this.sessionState.get(sessionId);
    const cwd = info?.cwd || override.cwd || cwdOverride || env.workspaceDir;

    const manager = info
      ? SessionManager.open(info.path, env.sessionsRoot, cwd)
      : SessionManager.create(cwd, env.sessionsRoot, { id: sessionId });

    const model =
      this.runtime.resolveModelRef(override.model) ?? this.runtime.resolveModelRef(null);
    const thinkingLevel = override.thinkingLevel ?? this.runtime.getStatus().thinkingLevel;

    const { session } = await createAgentSession({
      cwd,
      agentDir: env.agentDir,
      modelRuntime: this.runtime.requireRuntime(),
      ...(model ? { model } : {}),
      thinkingLevel,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
    });

    const entry: PooledSession = { session, lastUsed: Date.now() };
    this.entries.set(sessionId, entry);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.entries.get(sessionId)?.session;
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
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
  }
}
