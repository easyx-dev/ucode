/** AgentSession 池：懒加载、同会话串行、空闲回收 */
import {
  type AgentSession,
  createAgentSession,
  getLatestCompactionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  COMPACTION_RECORD_CUSTOM_TYPE,
  type CompactionRecord,
  DEFAULT_PERMISSION_MODE,
  ERROR_CODES,
  GOAL_PROMPT_CUSTOM_TYPE,
  MODE_RECORD_CUSTOM_TYPE,
  PERMISSION_DECISION_CUSTOM_TYPE,
  type PermissionRecord,
  PRUNE_RECORD_CUSTOM_TYPE,
  RETRY_RECORD_CUSTOM_TYPE,
  type RetryRecord,
  type ServerEventPayload,
  type SessionStatus,
  type SessionSummary,
  SKILL_RECORD_CUSTOM_TYPE,
  type SkillRecord,
  SUBAGENT_RECORD_CUSTOM_TYPE,
  type SubagentSnapshot,
  type WebsearchConfig,
} from "@ucode/contracts";
import {
  RETRY_MAX_ATTEMPTS,
  SUBAGENT_MAX_CONCURRENCY,
  SUBAGENT_QUEUE_MAX,
  SUBAGENT_QUEUE_WAIT_MS,
} from "../constants";
import type { SessionOverride, SessionRecord, SessionRepository } from "../db/session-repository";
import { overrideOf } from "../db/session-repository";

import { env } from "../env";
import {
  type AgentProfile,
  type AgentRegistry,
  hasPrimaryMode,
  loadAgentRegistry,
  parentModeRules,
  primaryCapability,
  primaryProfile,
  type ResolvedCapability,
  recommendedThinkingLevelOf,
  resolveSubagentCapability,
  subagentProfile,
  usesDefaultToolSet,
} from "../harness/agents";
import type { SkillIndex } from "../harness/assets";
import { matchSkillHit, matchSkillInvoke } from "../harness/assets/skill-hit";
import type { GoalService } from "../harness/goal";
import type { PromptImage } from "../harness/image";
import type { MemoryService } from "../harness/memory";
import type { PermissionRule, SessionAllowStore } from "../harness/permissions";
import { pruneToolOutputs } from "../harness/prune";
import { assembleSession, contextBudgetFor, resolveSessionCwd } from "../harness/session-config";
import { type SubagentHooks, SubagentSlots, spawnSubagent } from "../harness/subagents";
import { StepTelemetry } from "../harness/telemetry";
import type { UsageService } from "../harness/usage";
import { cleanOrphanWorkspaces, ensureWorkspaceDir, workspaceDirOf } from "../harness/workspace";
import { logger } from "../lib/logger";
import { AppError } from "../lib/response";
import { isRecord } from "../utils/object";
import { compactionSkipReasonOf } from "./compaction-skip";
import type { SessionEventBus } from "./event-bus";
import type { InteractionBroker, InteractionSource } from "./interactions";
import { isPlanAwaitingDecision } from "./plan-state";
import { appendSessionRecord } from "./records";
import { planRecycle } from "./recycle";
import {
  hasRunSettingsChanged,
  lastRunSettingsOf,
  type RunSettings,
  runSettingsPatch,
} from "./run-settings";
import { RunTracker } from "./run-tracker";
import type { PiRuntime } from "./runtime";
import { managerToIndex } from "./session-index";
import { sessionStatusOf } from "./session-status";
import { describeSessionSummary } from "./session-summary";

type PooledSession = {
  session: AgentSession;
  lastUsed: number;
  /** 会话事件订阅解绑（落盘补索引 + 落定后动作）；随池回收一并释放 */
  unsubscribe: () => void;
  /** 配置已变更：这一轮跑完（或下次访问）就按新配置重建 */
  stale: boolean;
  /** 本次装配的技能索引：命中判定与显式调用都查它，与广告给模型的同一份 */
  skills: SkillIndex;
  /** 本轮已记过的技能名：同一轮里分片读同一个文件只留第一条，轮次边界清空 */
  skillHits: Set<string>;
};

/** 库里那份会话参数：权限档位缺省即默认档（写设置点与校准回读共用同一口径） */
const runSettingsOf = (record: SessionRecord): RunSettings => ({
  mode: record.mode,
  permissionMode: overrideOf(record).permissionMode ?? DEFAULT_PERMISSION_MODE,
});

/**
 * 内存中的 AgentSession 池。
 * 会话历史由 pi 持久化到 JSONL，这里只保留活跃进程状态，空闲后回收；
 * 列表与详情所需的索引字段由 `SessionRepository` 从 SQLite 直接读取。
 */
export class SessionPool {
  private readonly entries = new Map<string, PooledSession>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** 运行占位、出错标记与收尾顺序（见 `RunTracker`） */
  private readonly runs = new RunTracker({
    writeIndex: (sessionId) => this.writeIndex(sessionId),
    onReleased: (sessionId) => {
      this.recycleIfStale(sessionId);
    },
    emitSummary: (sessionId) => this.emitUpdated(sessionId, true),
  });
  /** 正在处理落定后动作（目标续跑等）的会话：此时不做配置回收 */
  private readonly settling = new Set<string>();
  /** 已把列表索引写进库的会话：首轮期间按条目补写只做一次 */
  private readonly indexedSources = new Set<string>();
  /**
   * 进行中的子智能体：父会话 → toolCallId → 快照视图。
   * 嵌套进度不落盘，只靠事件增量维护 —— 客户端断流时错过 `subagent_end` 就会永远停在「执行中」，
   * 所以这里留一份清单随 `messages/list` 快照下发（见 `runningSubagentsOf`）。
   */
  private readonly subagents = new Map<string, Map<string, SubagentSnapshot>>();
  /** 配置代次：每换一次运行时自增，用来识别「装配跨过了配置变更」的实例 */
  private generation = 0;
  /** 每步耗时归因：把模型往返拆成首 token / 解码 / 工具三段，写进会话条目 */
  private readonly telemetry = new StepTelemetry();
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
  ) {
    // 交互请求的出现与结算都改变会话状态（等待授权 / 等待回答），要补一帧摘要，
    // 否则侧栏与通知只能等到下一次摘要刷新才知道这条会话停在了用户身上
    this.events.subscribe((frame) => {
      // 子智能体的起止只走事件流：这里留一份进行中清单，供快照收敛客户端嵌套进度
      if (frame.type === "subagent_start" || frame.type === "subagent_end") {
        this.trackSubagent(frame);
        return;
      }
      // 等用户的时间单独记账：审批 / 提问挂起多久就记多久，不从「工具耗时」里混过去
      if (frame.type === "interaction_request") {
        this.telemetry.beginUserWait(frame.sessionId, Date.now());
        this.emitUpdated(frame.sessionId);
        return;
      }
      if (frame.type === "interaction_resolved") {
        this.telemetry.endUserWait(frame.sessionId, Date.now());
        this.emitUpdated(frame.sessionId);
        return;
      }
    });
  }

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
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(sessionId, tail);
    // 链排空后释放条目；仍指向自己才删，否则会把后来者接上的链一起丢掉，
    // 让后续请求绕过还在排队的任务
    void tail.then(() => {
      if (this.locks.get(sessionId) === tail) this.locks.delete(sessionId);
    });
    return next;
  }

  /** 生成落定后回写索引（名称 / 条目数 / 预览 / 时间），并把摘要与用量下发给所有客户端 */
  refreshIndex(sessionId: string): void {
    if (!this.entries.has(sessionId)) return;
    this.writeIndex(sessionId);
    this.emitUpdated(sessionId, true);
  }

  /** 重算并下发一帧摘要（供池外的写点，如自动生成的标题回写后） */
  refreshSummary(sessionId: string): void {
    this.emitUpdated(sessionId, true);
  }

  /**
   * 快照用：该会话仍在进行的子智能体。
   * 客户端据此重建嵌套进度，并把本地多出来的（快照里已不存在的）收敛为已结束。
   */
  runningSubagentsOf(sessionId: string): SubagentSnapshot[] {
    return [...(this.subagents.get(sessionId)?.values() ?? [])];
  }

  /** 维护进行中清单；载荷不可信，拿不到 toolCallId 就当没有这次委派 */
  private trackSubagent(frame: ServerEventPayload): void {
    const parentId = frame.sessionId;
    const data = isRecord(frame.data) ? frame.data : {};
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    if (!toolCallId) return;

    const running = this.subagents.get(parentId) ?? new Map<string, SubagentSnapshot>();
    if (frame.type === "subagent_end") {
      running.delete(toolCallId);
      if (running.size === 0) this.subagents.delete(parentId);
      return;
    }

    running.set(toolCallId, {
      toolCallId,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
      description: typeof data.description === "string" ? data.description : "",
    });
    this.subagents.set(parentId, running);
  }

  /**
   *
   * 除了落定后的例行回写，会话文件一落盘也会补写一次：`source_path` 入库之前若实例被回收
   * （服务重启 / 空闲回收 / 配置变更），下次重装会另开一份 JSONL，把已有上下文整个丢掉。
   */
  private writeIndex(sessionId: string): boolean {
    const session = this.entries.get(sessionId)?.session;
    if (!session) return false;
    const index = managerToIndex(session.sessionManager);
    if (!index) return false;
    // 写库失败不能打断收尾：索引只影响列表展示，而收尾链上的「释放占位 + 补发摘要」
    // 一旦跳过，会话就永远停在运行态（见 `RunTracker` 的收尾顺序）
    try {
      this.repository.refresh(sessionId, index);
    } catch (error) {
      logger.warn({ sessionId, error }, "写入会话索引失败");
      return false;
    }
    this.indexedSources.add(sessionId);
    return true;
  }

  /** 读当前摘要（供事件下发）；会话不在仓储时返回 null */
  private summaryOf(sessionId: string): SessionSummary | null {
    return describeSessionSummary(
      {
        repository: this.repository,
        isActive: (id) => this.isActive(id),
        statusOf: (id) => this.statusOf(id),
        defaultModel: () => this.runtime.getStatus().defaultModel,
        effectiveThinkingLevel: (id) => this.get(id)?.thinkingLevel ?? null,
        // 只有「会话不在内存 + 偏好 auto」才走到这里，按需加载注册表即可，不必缓存
        recommendedThinkingLevel: (record) =>
          recommendedThinkingLevelOf(
            record.mode,
            loadAgentRegistry({ cwd: resolveSessionCwd(record), appHome: env.homeDir }),
          ),
      },
      sessionId,
    );
  }

  /** 下发摘要变更；`withUsage` 用于落定后（累计用量与上下文占用此时才写入口径） */
  private emitUpdated(sessionId: string, withUsage = false): void {
    const session = this.summaryOf(sessionId);
    if (!session) return;
    if (!withUsage) {
      this.events.emitSessionUpdated(sessionId, session);
      return;
    }
    const record = this.repository.find(sessionId);
    if (!record) {
      this.events.emitSessionUpdated(sessionId, session);
      return;
    }
    const live = this.entries.get(sessionId)?.session;
    this.events.emitSessionUpdated(
      sessionId,
      session,
      this.usage.usageOf(record, { live }),
      this.usage.contextUsageOf(record, { live }),
    );
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
      throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断或等本轮结束", 409);
    }
    this.recordRunSettings(sessionId);
    void session
      .prompt(text, images.length > 0 ? { images: [...images] } : undefined)
      .catch((error) => this.reportRunError(sessionId, error))
      .finally(() => this.endRun(sessionId));
  }

  /**
   * 起一轮**合成输入**（目标的启动 / 续跑 / 恢复、计划批准）：内容不是用户打的字，走
   * `custom_message` 落地——pi 会把它当 user 文本送进模型，但条目类型与来源都标得出来，
   * 对话里也不再装成用户气泡。
   */
  startInjectedRun(
    sessionId: string,
    session: AgentSession,
    injected: { customType: string; content: string; details?: unknown },
  ): void {
    if (!this.beginRun(sessionId)) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断或等本轮结束", 409);
    }
    this.recordRunSettings(sessionId);
    void session
      .sendCustomMessage(
        {
          customType: injected.customType,
          content: injected.content,
          display: true,
          ...(injected.details !== undefined ? { details: injected.details } : {}),
        },
        { triggerTurn: true },
      )
      .catch((error) => this.reportRunError(sessionId, error))
      .finally(() => this.endRun(sessionId));
  }

  /**
   * 目标续跑：注入下一条指令并起一轮。
   *
   * 条目落在盘上后补一个 `transcript_reset`：注入不产生普通消息事件，客户端不重取快照
   * 就看不到那行「目标续跑」。
   */
  private startGoalRun(
    sessionId: string,
    session: AgentSession,
    outcome: { content: string; turn: number },
  ): void {
    this.startInjectedRun(sessionId, session, {
      customType: GOAL_PROMPT_CUSTOM_TYPE,
      content: outcome.content,
      details: { kind: "continuation", turn: outcome.turn },
    });
    this.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: "" });
  }

  /**
   * 手动压缩上下文：后台执行，结果走事件流（`compaction_start` / `compaction_end`）。
   * 与一轮生成共用 `running` 占位，保证压缩期间不会被并发 prompt 打断。
   */
  startCompaction(sessionId: string, session: AgentSession, instructions?: string): void {
    if (!this.beginRun(sessionId)) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正忙，请先中断", 409);
    }
    void this.runCompaction(sessionId, session, instructions);
  }

  /**
   * 压缩的收尾：**先 `endRun`、再让客户端重取快照**，顺序是硬约束——
   * 快照里的 `running` 取自占位状态，占位未释放时重取会把生成态写成真，
   * 而手动压缩不会再发 `agent_settled`，界面就永久停在「生成中」（见 `RunTracker` 的说明）。
   */
  private async runCompaction(
    sessionId: string,
    session: AgentSession,
    instructions?: string,
  ): Promise<void> {
    let compacted = false;
    try {
      const result = await session.compact(instructions);
      compacted = true;
      this.recordCompaction(session, {
        reason: "manual",
        outcome: "done",
        tokensBefore: result.tokensBefore,
        ...(result.estimatedTokensAfter !== undefined
          ? { tokensAfter: result.estimatedTokensAfter }
          : {}),
        ...(result.firstKeptEntryId ? { keptFrom: result.firstKeptEntryId } : {}),
      });
    } catch (error) {
      const skipped = compactionSkipReasonOf(error);
      if (skipped) {
        // 没做任何事，不算失败：不进「本轮出错」，只把拒绝原因带给客户端弹一条轻提示
        // 条目要落在提示之前：客户端收到 compaction_end 后可能重取快照，那时得已经能在文件里找到它
        this.recordCompaction(session, { reason: "manual", outcome: "skipped", skip: skipped });
        this.events.emitFrame(sessionId, "compaction_end", { reason: "manual", skipped });
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        this.recordCompaction(session, { reason: "manual", outcome: "failed", error: reason });
        this.reportRunError(
          sessionId,
          new AppError(ERROR_CODES.compactionFailed, "压缩失败", 500, undefined, { reason }),
        );
      }
    } finally {
      this.endRun(sessionId);
    }
    if (compacted) this.resetTranscript(sessionId, session);
  }

  /**
   * 把一次压缩的结果落成扩展条目：pi 的 `compaction` 条目只有摘要与压缩前规模，
   * 触发来源、跳过与失败都不在里面（以前只发一条 SSE 提示，刷新即失）。
   *
   * 全程 best-effort：观测记录不能影响压缩本身。
   */
  private recordCompaction(session: AgentSession, record: Omit<CompactionRecord, "at">): void {
    try {
      session.sessionManager.appendCustomEntry(COMPACTION_RECORD_CUSTOM_TYPE, {
        ...record,
        at: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn({ error }, "写入压缩记录失败");
    }
  }

  /**
   * 可见历史被压缩重写（早期条目被摘要替代、只剩从 `firstKeptEntryId` 起的保留区间）：
   * 让客户端丢弃本地历史、重新取快照。
   */
  private resetTranscript(sessionId: string, session: AgentSession): void {
    const compaction = getLatestCompactionEntry(session.sessionManager.getBranch());
    const fromEntryId = compaction?.firstKeptEntryId ?? compaction?.id ?? "";
    this.events.emitFrame(sessionId, "transcript_reset", { fromEntryId });
  }

  /** 后台失败只能通过事件流回传，发起请求的连接此时可能早已断开 */
  private reportRunError(sessionId: string, error: unknown): void {
    const code = error instanceof AppError ? error.code : ERROR_CODES.internal;
    const message = error instanceof Error ? error.message : String(error);
    // 先标记再回传：随后的收尾帧据此把状态写成「本轮出错」
    this.runs.fail(sessionId);
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
      // 父一侧只施加模式规则：默认规则与「本会话恒允」都在子会话自己的规则里，重复施加会让
      // 用户已放行的范围在子会话里反复弹审批（见 `parentModeRules`）
      parentRules: () => parentModeRules(parentMode, registry),
    };
  }

  /**
   * 清掉过期的工具输出（`context_edit` 只改模型看到的视图，见 `harness/prune`），并落一条
   * `PRUNE_RECORD_CUSTOM_TYPE` 记录：上下文里那批工具输出是哪一轮、被谁清掉的、省了多少，
   * 只有文件里查得到。
   */
  private pruneContext(session: AgentSession): void {
    try {
      const outcome = pruneToolOutputs(session.sessionManager);
      if (outcome.cleared === 0) return;
      logger.debug(
        { cleared: outcome.cleared, freedTokens: outcome.freedTokens },
        "清理了过期的工具输出",
      );
      session.sessionManager.appendCustomEntry(PRUNE_RECORD_CUSTOM_TYPE, {
        cleared: outcome.cleared,
        freedTokens: outcome.freedTokens,
        targets: outcome.targets,
        at: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn({ error }, "清理过期工具输出失败");
    }
  }

  /** 主会话的委派钩子：并发上限按父会话计数，满了排队等空位（见 `SubagentSlots`） */
  private subagentHooks(
    record: SessionRecord,
    cwd: string,
    registry: AgentRegistry,
  ): SubagentHooks {
    const slots = new SubagentSlots(
      SUBAGENT_MAX_CONCURRENCY,
      SUBAGENT_QUEUE_MAX,
      SUBAGENT_QUEUE_WAIT_MS,
    );
    return {
      spawn: async (toolCallId, request, signal) => {
        // 模型覆盖先校验：拼错的 provider/model 应显式报错，而不是静默回落默认模型
        if (request.model && !this.runtime.resolveModelRef(request.model)) {
          throw new Error(`子智能体指定的模型不可用：${request.model}`);
        }
        const slot = await slots.acquire(signal);
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
              // 父会话正在跑（委派发生在它的工具调用里），记录走池里那个 manager
              record: (data) =>
                appendSessionRecord(
                  record,
                  SUBAGENT_RECORD_CUSTOM_TYPE,
                  { ...data, at: new Date().toISOString() },
                  this.get(record.id)?.sessionManager,
                ),
              dispose: (id) => {
                this.dispose(id);
              },
              emit: (type, data) => this.events.emitFrame(record.id, type, data),
              emitSessionCreated: (id) => this.emitCreated(id),
            },
          );
        } finally {
          slot.release();
        }
      },
    };
  }

  /**
   * 按 id 认领会话目录里已经落盘的文件，供库里还没有 `source_path` 的行续接。
   *
   * 这种行来自「首轮还没落定就被回收」：文件已经写在盘上、库里却不知道。
   * 重装时若按 id 新建，上下文会清空，所以先找回已有文件接上；`cwd` 必须与文件 header 一致，
   * 否则 pi 按目录找同一会话时会因 cwd 不匹配而跳过。
   */
  private claimSessionFile(sessionId: string, cwd: string): string | undefined {
    const found = SessionManager.findById(cwd, sessionId, env.sessionsDir);
    if (found) logger.warn({ sessionId, path: found }, "会话行没有文件路径，已按 id 认领会话文件");
    return found;
  }

  async ensure(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    // 配置变更标脏的实例不活跃即可回收，落到下面按新配置重装
    if (existing?.stale) this.recycleIfStale(sessionId);
    const pooled = this.entries.get(sessionId);
    if (pooled) {
      pooled.lastUsed = Date.now();
      return pooled.session;
    }

    // 装配要跨 await（loader 重建、MCP 连接），期间配置可能被换掉；
    // 那时回收计划扫不到这个还没入池的实例，只能靠代次比对补标脏
    const generation = this.generation;
    let record = this.repository.find(sessionId);
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
    // 绑定目录的会话在用户自己的目录里干活，没有工作区这回事
    // 子会话的 cwd 是父会话目录，不在这里建目录
    if (cwd === workspaceDirOf(sessionId)) ensureWorkspaceDir(sessionId);

    const sourcePath = record.sourcePath ?? this.claimSessionFile(sessionId, cwd);
    const manager = sourcePath
      ? SessionManager.open(sourcePath, env.sessionsDir, cwd)
      : SessionManager.create(cwd, env.sessionsDir, { id: sessionId });
    if (!sourcePath) {
      // 新会话的第一条设置点：pi 只在有 user / assistant 消息时才落盘，这条会随首条消息一起写出去、
      // 位置在它之前，天然就是「这一轮跑在什么参数下」的起点（子会话也走这里）
      manager.appendCustomEntry(MODE_RECORD_CUSTOM_TYPE, {
        ...runSettingsOf(record),
        at: new Date().toISOString(),
      });
    }

    // 自定义角色按 cwd 祖先链 + 全局目录现读：用户新加 / 改角色文件后，新建或重开的会话即生效
    const registry = loadAgentRegistry({ cwd, appHome: env.homeDir });
    if (registry.errors.length > 0) {
      logger.warn({ errors: registry.errors }, "跳过了无法解析的自定义子角色");
    }
    // 打开已有会话：文件是权威、DB 是缓存。文件里有设置点就以它为准回写，删库 / 拷文件都不会丢模式；
    // 未知 slug（自定义角色已删）不回写，装配侧本就有兑底
    if (sourcePath) {
      // 打开已有会话：文件是权威、DB 是缓存，文件里有设置点就以它为准回写；
      // 值不可用（模式 slug 已删 / 权限档位非法）时不回写，由 `runSettingsPatch` 判定
      const patch = runSettingsPatch(
        lastRunSettingsOf(manager.getBranch()),
        { mode: record.mode, permissionMode: record.permissionMode },
        (slug) => hasPrimaryMode(slug, registry),
      );
      if (patch) {
        this.repository.set(sessionId, patch);
        // 重新取一份：本轮装配要用校准后的值，否则校准要等下一轮才生效
        record = this.repository.find(sessionId) ?? record;
      }
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

    const assembled = await assembleSession({
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
        request: async (ask) => {
          const outcome = await this.permissions.interactions.requestPermission(
            interactionSessionId,
            ask,
            source,
          );
          // 只有用户真的作答过才留痕：超时 / 中断代打的 deny 写成「已拒绝」会误导事后回放
          if (outcome.byUser) {
            // 记录落在**被提问的会话**上：方案里子会话的审批归属根会话、弹窗也只出现在根会话，
            // 用户答复时看的就是它；落在发起调用的子会话里，人再也对不上眼
            const target =
              interactionSessionId === sessionId
                ? manager
                : this.entries.get(interactionSessionId)?.session.sessionManager;
            this.recordPermissionDecision(target, interactionSessionId, {
              tool: ask.tool,
              subject: ask.subject,
              scope: ask.scope,
              decision: outcome.decision,
              ...(source ?? {}),
            });
          }
          return outcome.decision;
        },
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
    });
    const { session } = await createAgentSession(assembled.options);

    // 会话已创建、但还没入池：这之后的任何失败都要先 dispose，否则会话（及其可能拉起的
    // MCP 子进程）会脱离池被泄漏
    try {
      // MCP 扩展在 `session_start` 时才连接 mcp.json 的服务器，必须显式触发；
      // 只有继承默认工具集、够得着扩展工具的会话才挂了它（见 session-config）
      if (mode === "build" && usesDefaultToolSet(capability)) await session.bindExtensions({});

      const unsubscribe = session.subscribe((event) => {
        // 每步耗时归因：只看 turn_start / message_start / 首个内容帧 / message_end / turn_end
        this.telemetry.observe(sessionId, event, session.sessionManager, session.thinkingLevel);
        // 技能命中：轮次起头清空已记集合，读到技能文件（`SKILL.md`）时记一条
        if (event.type === "turn_start") {
          this.entries.get(sessionId)?.skillHits.clear();
        } else if (event.type === "tool_execution_start") {
          this.observeSkillHit(sessionId, event.toolName, event.args, event.toolCallId);
        } else if (event.type === "auto_retry_start") {
          this.appendMarker(sessionId, session.sessionManager, {
            customType: RETRY_RECORD_CUSTOM_TYPE,
            label: "重试记录",
            data: {
              event: "start",
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
              ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
              at: new Date().toISOString(),
            },
          });
        } else if (event.type === "auto_retry_end") {
          // 成功的那条界面不需要（紧接着就是正常输出）；写进文件供回溯
          this.appendMarker(sessionId, session.sessionManager, {
            customType: RETRY_RECORD_CUSTOM_TYPE,
            label: "重试记录",
            data: {
              event: "end",
              attempt: event.attempt,
              maxAttempts: RETRY_MAX_ATTEMPTS,
              success: event.success,
              ...(event.finalError ? { errorMessage: event.finalError } : {}),
              at: new Date().toISOString(),
            },
          });
        }
        // 文件一落盘就把索引写进库，不等本轮落定：中间被回收或服务重启时才有文件可续接
        if (event.type === "message_end" || event.type === "entry_appended") {
          if (!this.indexedSources.has(sessionId)) this.writeIndex(sessionId);
          return;
        }
        // 压缩完成：记下新的上下文规模，并让客户端重取被重写过的历史。
        // 手动压缩的占位由 `runCompaction` 在释放后才收尾，这里只就地处理自动压缩
        // （threshold / overflow 发生在生成中途，run 还要继续跑，等不到落定）
        if (event.type === "compaction_end") {
          // 自动压缩（threshold / overflow）没有走 runCompaction，记录在这里补上；
          // 手动压缩的 success / skip / fail 由 runCompaction 写，这里不重复
          if (event.reason !== "manual") {
            if (event.result) {
              this.recordCompaction(session, {
                reason: event.reason,
                outcome: "done",
                tokensBefore: event.result.tokensBefore,
                ...(event.result.estimatedTokensAfter !== undefined
                  ? { tokensAfter: event.result.estimatedTokensAfter }
                  : {}),
                ...(event.result.firstKeptEntryId
                  ? { keptFrom: event.result.firstKeptEntryId }
                  : {}),
              });
            } else if (event.errorMessage) {
              this.recordCompaction(session, {
                reason: event.reason,
                outcome: "failed",
                error: event.errorMessage,
              });
            }
          }
          if (!event.result) return;
          const estimated = event.result.estimatedTokensAfter;
          if (estimated !== undefined) {
            this.usage.rememberCompaction(sessionId, estimated, {
              reason: event.reason,
              at: Date.now(),
            });
          }
          if (event.reason !== "manual") this.resetTranscript(sessionId, session);
          return;
        }
        // 本轮落定：先把已经用不上的旧工具输出清掉（子会话同样清），再走记忆回顾 / 目标续跑
        if (event.type === "agent_settled") this.pruneContext(session);
        // 子会话不参与记忆回顾与目标续跑，它的事件到索引补写为止
        if (isSubagent || event.type !== "agent_settled") return;
        // 记忆回顾挂在 `agent_settled`：一轮（含排队的后续输入）彻底落定后才回顾，
        // 避免把半截结论固化成项目记忆；目标续跑同为落定后动作
        this.memory.review(sessionId, session);
        // 落定后的两件事会争回收时机：目标要续跑就用旧装配把这一轮跑完，
        // 所以配置回收排在它们之后（settling 期间不回收）
        this.settling.add(sessionId);
        void this.goals
          .onSettled(sessionId, session)
          .then((outcome) => {
            if (!outcome) return;
            // 会话可能在校验期间被回收 / 重建：只有仍是池里这一个实例才起续跑
            if (this.entries.get(sessionId)?.session !== session) return;
            try {
              this.startGoalRun(sessionId, session, outcome.continue);
            } catch (error) {
              logger.warn({ sessionId, error }, "目标续跑启动失败");
            }
          })
          .catch((error: unknown) => logger.warn({ sessionId, error }, "目标落定处理失败"))
          .finally(() => {
            this.settling.delete(sessionId);
            this.recycleIfStale(sessionId);
          });
      });

      const entry: PooledSession = {
        session,
        lastUsed: Date.now(),
        unsubscribe,
        // 装配期间配置被换过：这一轮仍用这份旧装配跑完，下次访问按新配置重建
        stale: generation !== this.generation,
        skills: assembled.skills,
        skillHits: new Set(),
      };
      // 压缩触发点在这里算一次，同时喂给每步耗时记录与用量服务：
      // 口径与注入 pi 的阈值完全一致，界面上的「预算」不会与实际压缩点对不上
      const budget = contextBudgetFor({ record, capability, runtime: this.runtime });
      this.telemetry.attach(sessionId, budget?.triggerTokens ?? null);
      if (budget) this.usage.rememberBudget(sessionId, budget.triggerTokens);
      this.entries.set(sessionId, entry);
      // 事件订阅常驻：会话池回收前，/events 的在线订阅者要靠它拿到实时事件；
      // 序号也不能随 detach 重置，否则重连的客户端会错判帧的新旧
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
    return this.runs.isRunning(sessionId);
  }

  /** 是否有活跃生成：池内占位的 run，或会话本身处于流式中 */
  isActive(sessionId: string): boolean {
    return this.isRunning(sessionId) || this.get(sessionId)?.isStreaming === true;
  }

  /**
   * 把一次已答复的审批落成扩展条目，供事后回放「当时确认过什么」。
   *
   * 条目不进模型上下文；写盘失败或拿不到 manager 都不能影响审批结论，所以全程 best-effort。
   */
  private recordPermissionDecision(
    manager: SessionManager | undefined,
    sessionId: string,
    record: PermissionRecord,
  ): void {
    if (!manager) return;
    try {
      const entryId = manager.appendCustomEntry(PERMISSION_DECISION_CUSTOM_TYPE, record);
      this.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId });
    } catch (error) {
      logger.warn({ sessionId, error }, "写入权限审批记录失败");
    }
  }

  /**
   * 模型自己读到技能文件时记一条命中。同轮同一技能只记一次——模型分片读同一个 `SKILL.md`
   * （`offset` / `limit`）时会连着调好几次。
   */
  private observeSkillHit(
    sessionId: string,
    toolName: string,
    args: unknown,
    toolCallId: string | undefined,
  ): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const cwd = this.repository.find(sessionId)?.cwd ?? process.cwd();
    const skill = matchSkillHit(toolName, args, cwd, entry.skills);
    if (!skill || entry.skillHits.has(skill.name)) return;
    entry.skillHits.add(skill.name);
    this.appendMarker(sessionId, entry.session.sessionManager, {
      customType: SKILL_RECORD_CUSTOM_TYPE,
      label: "技能记录",
      data: {
        event: "hit",
        name: skill.name,
        file: skill.file,
        source: skill.source,
        ...(toolCallId ? { toolCallId } : {}),
        at: new Date().toISOString(),
      },
    });
  }

  /**
   * 显式 `/skill:name` 的记录：只落文件、不下发界面——用户消息上的 chip 已经表达过这件事。
   * 判定与写入都关在池里，调用方不接触资源装载。
   */
  noteSkillInvoke(sessionId: string, text: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const skill = matchSkillInvoke(text, entry.skills);
    if (!skill) return;
    this.appendMarker(sessionId, entry.session.sessionManager, {
      customType: SKILL_RECORD_CUSTOM_TYPE,
      label: "技能记录",
      data: {
        event: "invoke",
        name: skill.name,
        file: skill.file,
        source: skill.source,
        at: new Date().toISOString(),
      },
    });
  }

  /**
   * 轮开始时落一条本轮生效的运行参数（模式与权限档位）。
   *
   * 它不展示、也不参与投影：只供打开已有会话时校准 `app.db`（见 `./run-settings`）。
   * 去重对着会话文件里最后一条设置点，而不是内存：实例重装（重启 / 换模型 / 换权限档位都会
   * dispose）后内存那份会重置，同一份参数会被反复记一条。
   */
  private recordRunSettings(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    const record = this.repository.find(sessionId);
    if (!entry || !record) return;
    const settings = runSettingsOf(record);
    const last = lastRunSettingsOf(entry.session.sessionManager.getBranch());
    if (!hasRunSettingsChanged(last, settings)) return;
    this.appendMarker(sessionId, entry.session.sessionManager, {
      customType: MODE_RECORD_CUSTOM_TYPE,
      label: "运行参数记录",
      data: { ...settings, at: new Date().toISOString() },
    });
  }

  /**
   * 写一条观测条目（技能命中 / 重试）并让在线客户端重取转录，与审批记录同一做法。
   * 失败只记日志：记录不该影响这一轮的投递。
   */
  private appendMarker(
    sessionId: string,
    manager: SessionManager | undefined,
    entry: { customType: string; data: unknown; label: string },
  ): void {
    if (!manager) return;
    try {
      const entryId = manager.appendCustomEntry(entry.customType, entry.data);
      this.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId });
    } catch (error) {
      logger.warn({ sessionId, error }, `${entry.label}写入失败`);
    }
  }

  /**
   * 同步占位：返回 true 表示当前请求负责开启这一轮，false 表示已有 run 在跑。
   * 调用方必须在结束时 endRun()。用于避免并发 prompt() 竞争。
   */
  beginRun(sessionId: string): boolean {
    if (!this.runs.begin(sessionId)) return false;
    // 所有客户端据此把该会话标成运行态，而不是等下一次列表刷新
    this.emitUpdated(sessionId);
    return true;
  }

  /** 收尾：写索引 → 释放占位 → 补发摘要；顺序理由见 `RunTracker.finish` */
  endRun(sessionId: string): void {
    this.runs.finish(sessionId);
  }

  /**
   * 会话状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。
   * 判定口径在 `core/session-status`；这里只负责把池内的几个来源取出来。
   */
  statusOf(sessionId: string): SessionStatus {
    return sessionStatusOf({
      active: this.isActive(sessionId),
      errored: this.runs.isErrored(sessionId),
      pending: this.permissions.interactions.list(sessionId).map((request) => request.kind),
      planPending: this.isPlanPending(sessionId),
    });
  }

  /**
   * 本轮是否以 present_plan 收尾且尚未决策。
   * 只有 plan 模式才可能待确认；实例不在池里（未加载 / 已被空闲回收）时无从判定，按「没有」处理。
   */
  private isPlanPending(sessionId: string): boolean {
    if (this.repository.find(sessionId)?.mode !== "plan") return false;
    const session = this.entries.get(sessionId)?.session;
    if (!session) return false;
    // 按活动分支（compaction / 分支感知）回扫：`getEntries()` 是全部条目，
    // 在「分支到旧条目且之后没追加」时会把其它分支的 present_plan 算进来
    return isPlanAwaitingDecision(session.sessionManager.buildContextEntries());
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
    this.runs.forget(sessionId);
    this.settling.delete(sessionId);
    this.indexedSources.delete(sessionId);
    this.subagents.delete(sessionId);
    this.events.detach(sessionId);
    this.usage.forget(sessionId);
    this.telemetry.detach(sessionId);
    this.memory.discardReview(sessionId);
    this.goals.forget(sessionId);
    // 挂起审批 / 提问按失败结算，避免回答打到已释放的实例：子会话的请求挂在父会话下
    // 并带 source 标注，主会话的请求就挂在自己名下
    const parentSessionId = this.repository.find(sessionId)?.parentSessionId ?? null;
    if (parentSessionId) this.permissions.interactions.forgetSource(parentSessionId, sessionId);
    else this.permissions.interactions.forget(sessionId);
    try {
      entry.unsubscribe();
    } catch {
      // pi 侧已释放，忽略
    }
    try {
      entry.session.dispose();
    } catch {
      // 忽略 dispose 异常
    }
    // 实例离池会让只存在内存里的状态失效：「本轮出错」「等待计划确认」都取自池内实例，
    // 不补一帧的话侧栏会一直挂着错误 / 等待标记（归档路径随后还会发 `session_archived`，顺序无碍）
    const record = this.repository.find(sessionId);
    if (record && !record.deletedAt) this.emitUpdated(sessionId);
    return true;
  }

  disposeAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.dispose(sessionId);
    }
  }

  /**
   * 配置变更后的会话回收：空闲实例立即丢弃（下次访问按新配置重装），
   * 正在生成 / 压缩的实例只标脏 —— 不打断这一轮，等它落定后回收。
   */
  recycleForConfigChange(): void {
    this.generation += 1;
    const plan = planRecycle(
      [...this.entries.keys()].map((id) => ({ id, active: this.isActive(id) })),
    );
    for (const sessionId of plan.markStale) {
      const entry = this.entries.get(sessionId);
      if (entry) entry.stale = true;
    }
    for (const sessionId of plan.dispose) this.dispose(sessionId);
  }

  /** 标脏的实例已空闲就回收；还在跑或正处理落定动作时留给下一处兜底 */
  private recycleIfStale(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry?.stale) return false;
    if (this.isActive(sessionId) || this.settling.has(sessionId)) return false;
    return this.dispose(sessionId);
  }

  activeCount(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.entries) {
      // 配置变更留下的脏实例：一旦不活跃就回收，不必等空闲超时
      if (entry.stale && this.recycleIfStale(sessionId)) continue;
      if (entry.session.isStreaming) continue;
      if (this.runs.isRunning(sessionId)) continue;
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
