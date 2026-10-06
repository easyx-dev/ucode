/** AgentSession 池：懒加载、同会话串行、空闲回收 */
import {
  type AgentSession,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { ERROR_CODES, type SessionSummary, type WebsearchConfig } from "@ucode/contracts";

import {
  type AgentProfile,
  type AgentRegistry,
  agentRules,
  loadAgentRegistry,
  primaryCapability,
  primaryProfile,
  type ResolvedCapability,
  resolveSubagentCapability,
  subagentProfile,
  usesDefaultToolSet,
} from "../harness/agents";
import type { GoalService } from "../harness/goal";
import type { PromptImage } from "../harness/image";
import type { MemoryService } from "../harness/memory";
import type { PermissionRule, SessionAllowStore } from "../harness/permissions";
import { buildSessionOptions, resolveSessionCwd } from "../harness/session-config";
import { type SubagentHooks, spawnSubagent } from "../harness/subagents";
import type { UsageService } from "../harness/usage";
import { cleanOrphanWorkspaces, ensureWorkspaceDir, workspaceDirOf } from "../harness/workspace";
import { SUBAGENT_MAX_CONCURRENCY } from "../constants";
import type { SessionRecord, SessionRepository } from "../db/session-repository";
import { env } from "../env";
import { logger } from "../lib/logger";
import { AppError } from "../lib/response";
import type { SessionEventBus } from "./event-bus";
import type { InteractionBroker, InteractionSource } from "./interactions";
import type { PiRuntime } from "./runtime";
import { indexFromManager } from "./session-index";
import { describeSessionSummary } from "./session-summary";

type PooledSession = {
  session: AgentSession;
  lastUsed: number;
  /** 会话落定事件的订阅解绑；随池回收一并释放 */
  memoryUnsubscribe: () => void;
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
    /** 项目级记忆：落定后自动回顾，并把索引 / 工具接进会话装配 */
    private readonly memory: MemoryService,
    /** 目标模式：落定后校验并按需续跑 */
    private readonly goals: GoalService,
    /** 使用统计：落定后随 `session_updated` 一起下发累计用量 */
    private readonly usage: UsageService,
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

  /** 生成落定后回写索引（名称 / 条目数 / 预览 / 时间），并把摘要与用量下发给所有客户端 */
  refreshIndex(sessionId: string): void {
    const session = this.entries.get(sessionId)?.session;
    if (!session) return;
    const index = indexFromManager(session.sessionManager);
    if (index) this.repository.refresh(sessionId, index);
    this.emitUpdated(sessionId, true);
  }

  /** 读当前摘要（供事件下发）；会话不在仓储时返回 null */
  private summaryOf(sessionId: string): SessionSummary | null {
    return describeSessionSummary(
      {
        repository: this.repository,
        isActive: (id) => this.isActive(id),
        defaults: () => {
          const status = this.runtime.getStatus();
          return { model: status.defaultModel, thinkingLevel: status.thinkingLevel };
        },
      },
      sessionId,
    );
  }

  /** 下发摘要变更；`withUsage` 用于落定后（累计用量此时才写入口径） */
  private emitUpdated(sessionId: string, withUsage = false): void {
    const session = this.summaryOf(sessionId);
    if (!session) return;
    if (!withUsage) {
      this.events.emitSessionUpdated(sessionId, session);
      return;
    }
    const record = this.repository.find(sessionId);
    const usage = record
      ? this.usage.usageOf(record, { live: this.entries.get(sessionId)?.session })
      : undefined;
    this.events.emitSessionUpdated(sessionId, session, usage);
  }

  /** 子会话创建成功后下发，供列表与导航插入新行 */
  private emitCreated(sessionId: string): void {
    const session = this.summaryOf(sessionId);
    if (session) this.events.emitSessionCreated(sessionId, session);
  }

  /**
   * 开一轮后台生成：立即返回，不 await；生成所有权在服务端，结果走事件流。
   * HTTP 触发与目标续跑共用这一条路径，保证 `running` / 索引刷新 / 错误回传一致。
   */
  startRun(
    sessionId: string,
    session: AgentSession,
    text: string,
    images: readonly PromptImage[] = [],
  ): void {
    if (!this.beginRun(sessionId)) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正忙，请稍后重试或改用 steer", 409);
    }
    void session
      .prompt(text, images.length > 0 ? { images: [...images] } : undefined)
      .catch((error) => this.reportRunError(sessionId, error))
      .finally(() => {
        this.endRun(sessionId);
        this.refreshIndex(sessionId);
      });
  }

  /**
   * 手动压缩上下文：后台执行，结果走事件流（`compaction_start` / `compaction_end`）。
   * 与一轮生成共用 `running` 占位，保证压缩期间不会被并发 prompt 打断。
   */
  startCompaction(sessionId: string, session: AgentSession, instructions?: string): void {
    if (!this.beginRun(sessionId)) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正忙，请先中断", 409);
    }
    void session
      .compact(instructions)
      .catch((error) => this.reportRunError(sessionId, error))
      .finally(() => {
        this.endRun(sessionId);
        this.refreshIndex(sessionId);
      });
  }

  /** 后台失败只能通过事件流回传，发起请求的连接此时可能早已断开 */
  private reportRunError(sessionId: string, error: unknown): void {
    const code = error instanceof AppError ? error.code : ERROR_CODES.internal;
    const message = error instanceof Error ? error.message : String(error);
    this.events.emitError(
      sessionId,
      code,
      message,
      error instanceof AppError ? error.params : undefined,
    );
  }

  /**
   * 解析会话的角色与能力：主会话直接用模式声明；子会话把父会话能力与子角色取交集。
   * v1 只禁一层递归，故父会话即主会话；放开嵌套时要沿 `parentSessionId` 链解析到根。
   */
  private resolveAgent(
    record: SessionRecord,
    registry: AgentRegistry,
  ): {
    profile: AgentProfile;
    capability: ResolvedCapability;
    parentRules?: () => readonly PermissionRule[];
  } {
    if (!record.parentSessionId || !record.agent) {
      return {
        profile: primaryProfile(record.mode, registry),
        capability: primaryCapability(record.mode, registry),
      };
    }
    const parent = this.repository.find(record.parentSessionId);
    const parentMode = parent?.mode ?? record.mode;
    const profile = subagentProfile(record.agent, registry);
    return {
      profile,
      capability: resolveSubagentCapability(profile, primaryCapability(parentMode, registry)),
      parentRules: () => agentRules(primaryProfile(parentMode, registry)),
    };
  }

  /** 主会话的委派钩子：并发上限按父会话计数，超限立即报错而非排队 */
  private subagentHooks(
    record: SessionRecord,
    cwd: string,
    registry: AgentRegistry,
  ): SubagentHooks {
    let active = 0;
    return {
      spawn: async (toolCallId, request, signal) => {
        // 模型覆盖先校验：拼错的 provider/model 应显式报错，而不是静默回落默认模型
        if (request.model && !this.runtime.resolveModelRef(request.model)) {
          throw new Error(`子智能体指定的模型不可用：${request.model}`);
        }
        if (active >= SUBAGENT_MAX_CONCURRENCY) {
          throw new Error(
            `同时运行的子智能体已达上限（${SUBAGENT_MAX_CONCURRENCY}），请等其中一个完成后再派。`,
          );
        }
        active += 1;
        try {
          return await spawnSubagent(
            {
              parent: record,
              toolCallId,
              cwd,
              request,
              registry,
              ...(signal ? { signal } : {}),
            },
            {
              createChild: (id, input) => this.repository.createChild(id, input),
              discardChild: (id) => this.repository.discardChild(id),
              findChild: (id) => this.repository.find(id),
              ensure: (id) => this.ensure(id),
              refresh: (id) => this.refreshIndex(id),
              settleInteractions: (id) => this.permissions.interactions.forgetSource(record.id, id),
              dispose: (id) => {
                this.dispose(id);
              },
              emit: (type, data) => this.events.emitFrame(record.id, type, data),
              emitSessionCreated: (id) => this.emitCreated(id),
            },
          );
        } finally {
          active -= 1;
        }
      },
    };
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
    const isSubagent = Boolean(record.parentSessionId && record.agent);

    // 只有未绑定目录的会话住工作区：它同时是这类会话的 cwd，跑之前必须存在；
    // 绑定目录的会话在用户自己的目录里干活，没有工作区这回事。
    // 子会话的 cwd 是父会话目录，不在这里建目录
    if (cwd === workspaceDirOf(sessionId)) ensureWorkspaceDir(sessionId);

    const manager = record?.sourcePath
      ? SessionManager.open(record.sourcePath, env.sessionsRoot, cwd)
      : SessionManager.create(cwd, env.sessionsRoot, { id: sessionId });

    // 自定义角色按 cwd 祖先链 + 全局目录现读：用户新加 / 改角色文件后，新建或重开的会话即生效
    const registry = loadAgentRegistry({ cwd, appHome: env.homeDir });
    if (registry.errors.length > 0) {
      logger.warn({ errors: registry.errors }, "跳过了无法解析的自定义子角色");
    }
    const { profile, capability, parentRules } = this.resolveAgent(record, registry);
    // 子会话的审批 / 提问归属根（v1 即父）会话，并带上来源标注
    const interactionSessionId = record.parentSessionId ?? sessionId;
    const source: InteractionSource | undefined =
      isSubagent && record.parentSessionId
        ? {
            sourceSessionId: sessionId,
            sourceDescription: record.name ?? profile.label,
          }
        : undefined;

    const { session } = await createAgentSession(
      await buildSessionOptions({
        record,
        cwd,
        mode,
        sessionManager: manager,
        runtime: this.runtime,
        profile,
        capability,
        ...(parentRules ? { parentRules } : {}),
        ...(isSubagent ? {} : { subagents: this.subagentHooks(record, cwd, registry) }),
        agentRegistry: registry,
        websearch: this.websearch,
        permission: {
          listGrants: () => this.permissions.allow.list(interactionSessionId),
          grant: (rule) => this.permissions.allow.add(interactionSessionId, rule),
          request: (ask) =>
            this.permissions.interactions.requestPermission(interactionSessionId, ask, source),
        },
        question: {
          ask: (ask, signal) =>
            this.permissions.interactions.requestQuestion(
              interactionSessionId,
              ask.questions,
              signal,
              source,
            ),
        },
        memory: this.memory,
      }),
    );

    // 会话已创建、但还没入池：这之后的任何失败都要先 dispose，否则会话（及其可能拉起的
    // MCP 子进程）会脱离池被泄漏
    try {
      // MCP 扩展在 `session_start` 时才连接 mcp.json 的服务器，必须显式触发；
      // 只有继承默认工具集、够得着扩展工具的会话才挂了它（见 session-config）
      if (mode === "build" && usesDefaultToolSet(capability)) await session.bindExtensions({});

      // 记忆回顾挂在 `agent_settled`：一轮（含排队的后续输入）彻底落定后才回顾。
      // 子会话不参与回顾，避免把半截结论固化成项目记忆；目标续跑同为落定后动作。
      const memoryUnsubscribe = isSubagent
        ? () => {}
        : session.subscribe((event) => {
            if (event.type !== "agent_settled") return;
            this.memory.review(sessionId, session);
            void this.goals
              .onSettled(sessionId, session)
              .then((outcome) => {
                if (!outcome) return;
                // 会话可能在校验期间被回收 / 重建：只有仍是池里这一个实例才起续跑
                if (this.entries.get(sessionId)?.session !== session) return;
                try {
                  this.startRun(sessionId, session, outcome.continue);
                } catch (error) {
                  logger.warn({ sessionId, error }, "目标续跑启动失败");
                }
              })
              .catch((error: unknown) => logger.warn({ sessionId, error }, "目标落定处理失败"));
          });

      const entry: PooledSession = { session, lastUsed: Date.now(), memoryUnsubscribe };
      this.entries.set(sessionId, entry);
      // 事件订阅常驻：会话池回收前，/events 的在线订阅者要靠它拿到实时事件；
      // 序号也不能随 detach 重置，否则重连的客户端会错判帧的新旧。
      this.events.attach(sessionId, session);
      return session;
    } catch (error) {
      try {
        session.dispose();
      } catch {
        // pi 侧已释放，忽略
      }
      throw error;
    }
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
    // 所有客户端据此把该会话标成运行态，而不是等下一次列表刷新
    this.emitUpdated(sessionId);
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
    this.memory.discardReview(sessionId);
    this.goals.forget(sessionId);
    try {
      entry.memoryUnsubscribe();
    } catch {
      // pi 侧已释放，忽略
    }
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
