/**
 * 使用统计：从 pi 会话记录里聚合每次 LLM 调用的 token 用量，并给出当前的上下文占用。
 *
 * 用量已经在会话 JSONL 里（assistant 消息的 `usage`、独立 `usage` 条目、compaction / branch_summary 的 `usage`），
 * 这里只做读取与聚合，不落库；按会话文件 mtime 缓存解析结果，避免重复扫描。
 * 口径与 pi 的 `getSessionStats()` 一致（合计 = input + output + cacheRead + cacheWrite），不计成本。
 * 上下文占用取最近一次可信回答的规模；压缩后到新一轮回答之间用压缩结果的估算顶替（见 `estimated`）。
 */
import { existsSync, statSync } from "node:fs";

import {
  type AgentSession,
  calculateContextTokens,
  getLastAssistantUsage,
  getLatestCompactionEntry,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  ContextUsage,
  ModelUsage,
  SessionUsageEntry,
  SessionUsageKind,
  StatsSummaryResponse,
  UsageTotals,
} from "@ucode/contracts";

import type { SessionRecord, SessionRepository } from "../../db/session-repository";
import { logger } from "../../lib/logger";
import { isRecord } from "../../utils/object";
import {
  addInto,
  dailyBuckets,
  dateKeysOf,
  emptyTotals,
  localDateKeyOf,
  maxChatDurationMs,
  nextDayStartMs,
  peakDayOf,
  startOfDayMsOfKey,
  streaksOf,
  weeklyBuckets,
} from "./aggregate";

/** 从 pi 的 `Usage` 形状安全取出四类 token；缺失或非数字按 0 处理 */
const readUsage = (value: unknown): UsageTotals => {
  if (!isRecord(value)) return emptyTotals();
  const num = (field: unknown): number =>
    typeof field === "number" && Number.isFinite(field) ? field : 0;
  const input = num(value.input);
  const output = num(value.output);
  const cacheRead = num(value.cacheRead);
  const cacheWrite = num(value.cacheWrite);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
};

/** 条目时间：优先消息自身毫秒时间戳，回落条目 ISO 时间；都拿不到为 0 */
const entryTimeMs = (entry: SessionEntry): number => {
  if (entry.type === "message") {
    const timestamp = (entry.message as { timestamp?: unknown }).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** assistant 消息 content 里的工具调用数 */
const countToolCalls = (message: unknown): number => {
  if (!isRecord(message) || !Array.isArray(message.content)) return 0;
  return message.content.filter((part) => isRecord(part) && part.type === "toolCall").length;
};

/** 一次 LLM 调用 / 用量条目解析出的一个用量点 */
type UsagePoint = {
  timeMs: number;
  provider: string | null;
  model: string | null;
  totals: UsageTotals;
  toolCalls: number;
};

/**
 * 当前分支的上下文占用 token 数：最近一次可信回答所面对的上下文大小。
 *
 * 可信口径复用 pi 的 `getLastAssistantUsage()`（中断 / 出错 / 零值的回答都不算基准）；压缩会重写上下文，
 * 压缩点之前那条回答的用量反映的是压缩前的规模，因此只有压缩之后新出的回答才能当基准——压缩后还没回答时
 * 只能算未知，与 pi 的 `getContextUsage()` 一致。
 * 与它的差别：这里不估算基准回答之后追加的消息（pi 的 `estimateProjectedContextTokens` 会加上这部分），
 * 落定时最后一条就是那条回答、两者相等，基准回答之后还有消息时（排队输入、中断轮）pi 会略高。
 */
const contextTokensOfBranch = (manager: SessionManager): number | null => {
  const branch = manager.getBranch();
  const compaction = getLatestCompactionEntry(branch);
  const afterCompaction = compaction ? branch.slice(branch.indexOf(compaction) + 1) : branch;
  const usage = getLastAssistantUsage(afterCompaction);
  return usage ? calculateContextTokens(usage) : null;
};

/** 把会话条目解析成用量点；不含用量的条目被跳过 */
const collectPoints = (entries: SessionEntry[]): UsagePoint[] => {
  const points: UsagePoint[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      // AgentMessage 是联合类型，这里按记录读取，避免对着判别联合做不安全的窄化
      const message = entry.message as unknown as Record<string, unknown>;
      if (message.role !== "assistant") continue;
      const totals = readUsage(message.usage);
      const toolCalls = countToolCalls(entry.message);
      if (totals.totalTokens === 0 && toolCalls === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: typeof message.provider === "string" ? message.provider : null,
        model: typeof message.model === "string" ? message.model : null,
        totals,
        toolCalls,
      });
      continue;
    }
    if (entry.type === "usage") {
      const totals = readUsage(entry.usage);
      if (totals.totalTokens === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: entry.provider,
        model: entry.model,
        totals,
        toolCalls: 0,
      });
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const totals = readUsage(entry.usage);
      if (totals.totalTokens === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: null,
        model: null,
        totals,
        toolCalls: 0,
      });
    }
  }
  return points;
};

type Aggregate = {
  totals: UsageTotals;
  byModel: ModelUsage[];
  toolCalls: number;
};

/** 聚合用量点；`sinceMs` 非空时只统计其后的点 */
const aggregate = (points: UsagePoint[], sinceMs?: number): Aggregate => {
  const totals = emptyTotals();
  const byModel = new Map<string, ModelUsage>();
  let toolCalls = 0;

  for (const point of points) {
    if (sinceMs !== undefined && point.timeMs < sinceMs) continue;
    addInto(totals, point.totals);
    toolCalls += point.toolCalls;
    if (!point.model) continue;
    const key = `${point.provider ?? ""}/${point.model}`;
    let entry = byModel.get(key);
    if (!entry) {
      entry = { provider: point.provider ?? "", model: point.model, totals: emptyTotals() };
      byModel.set(key, entry);
    }
    addInto(entry.totals, point.totals);
  }

  return {
    totals,
    byModel: [...byModel.values()].sort((a, b) => b.totals.totalTokens - a.totals.totalTokens),
    toolCalls,
  };
};

/** 把条目直接聚合成用量；服务内部按文件 mtime 缓存的是用量点，这里供测试与一次性读取 */
export const collectUsage = (entries: SessionEntry[], sinceMs?: number): Aggregate =>
  aggregate(collectPoints(entries), sinceMs);

/** 会话在统计里的来源分类 */
const kindOf = (record: SessionRecord): SessionUsageKind => {
  if (record.parentSessionId || record.agent) return "subagent";
  if (record.forkedFromId) return "forked";
  return "primary";
};

/** 解析单个会话文件的结果缓存条目 */
type CachedSessionUsage = {
  path: string;
  mtimeMs: number;
  points: UsagePoint[];
  /** 解析出的上下文占用 token 数；拿不到可信基准时为 null（见 `contextTokensOfBranch`） */
  contextTokens: number | null;
};

/**
 * 会话用量读取与全局汇总。
 * 只依赖仓储（列会话）、模型窗口解析器与文件系统；会话文件未变化时复用缓存，文件读取失败时保留上一次结果。
 */
export class UsageService {
  private readonly cache = new Map<string, CachedSessionUsage>();
  /**
   * 压缩后、还没有新回答时的上下文估算（pi 压缩结果里的 `estimatedTokensAfter`），按会话索引。
   * 存在进程内存：它只是「等新回答期间的展示回填」，服务重启后拿不到也不影响实测口径。
   */
  private readonly estimated = new Map<string, number>();
  /** 最近一次自动压缩：原因与时间，供界面说明「它为什么突然小了」 */
  private readonly compactions = new Map<string, { reason: string; at: number }>();
  /**
   * 装配时算出的压缩触发点（会话池写入）。**优先于下面按 `record.model` 的推算**：
   * 会话实际用的模型可能来自角色声明而不是记录上的覆盖，按记录推算会在「窗口来自实际模型、
   * 预算来自默认模型」之间对不上号。
   */
  private readonly budgets = new Map<string, number>();

  constructor(
    private readonly sessions: SessionRepository,
    /** 解析 `provider/model` 的上下文窗口；解析不到为 null（运行时相关，由装配层注入） */
    private readonly contextWindowOf: (modelRef: string | null) => number | null,
    /** 该模型的压缩触发点（与装配层注入 pi 的阈值同源）；解析不到为 null */
    private readonly contextBudgetOf: (modelRef: string | null) => number | null = () => null,
  ) {}

  /**
   * 单会话累计用量。
   *
   * 传 `live`（池内会话）时直接读内存条目，省掉「每轮重解析整份会话文件」的开销；
   * 离线 / 已回收的会话才回落到按文件 mtime 缓存。`sinceMs` 供阶段 11 goal 的区间查询。
   */
  usageOf(
    record: SessionRecord,
    options: { live?: AgentSession | undefined; sinceMs?: number } = {},
  ): UsageTotals {
    const points = options.live
      ? collectPoints(options.live.sessionManager.getEntries())
      : this.pointsOf(record);
    return aggregate(points, options.sinceMs).totals;
  }

  /**
   * 单会话当前上下文占用；没有任何可信口径、或模型窗口不可知时返回 null。
   *
   * 池内会话直接问 pi（内存里已有投影，不必重解析文件）；离线会话按文件 mtime 缓存读基准。
   * 压缩完成到新一轮回答之间 pi 给不出实测值，此时用压缩结果的估算顶替并置 `estimated`。
   */
  contextUsageOf(
    record: SessionRecord,
    options: { live?: AgentSession | undefined } = {},
  ): ContextUsage | null {
    // pi 的 getContextUsage() 每次都要重建投影，只问一次，窗口与 token 数同源取
    const piUsage = options.live?.getContextUsage();
    const contextWindow = piUsage?.contextWindow ?? this.contextWindowOf(record.model);
    const measured = options.live
      ? (piUsage?.tokens ?? null)
      : (this.cachedOf(record)?.contextTokens ?? null);
    const budget = this.budgets.get(record.id) ?? this.contextBudgetOf(record.model);
    const lastCompaction = this.compactions.get(record.id) ?? null;
    if (measured !== null && contextWindow !== null) {
      return { tokens: measured, contextWindow, estimated: false, budget, lastCompaction };
    }

    const estimated = this.estimated.get(record.id);
    if (estimated !== undefined && contextWindow !== null) {
      return { tokens: estimated, contextWindow, estimated: true, budget, lastCompaction };
    }
    return null;
  }

  /** 记下装配时算出的压缩触发点；与注入 pi 的阈值同源，见 `harness/budget` */
  rememberBudget(sessionId: string, triggerTokens: number): void {
    if (Number.isFinite(triggerTokens) && triggerTokens > 0) {
      this.budgets.set(sessionId, triggerTokens);
    }
  }

  /**
   * 记下一次压缩的结果：压缩后的估算规模 + 发生原因。
   * `tokens` 非法（非有限数 / 负数）时只记原因，不写估算——宁可继续给不出占用，也不要展示一个没意义的数。
   */
  rememberCompaction(
    sessionId: string,
    tokens: number,
    info?: { reason: string; at: number },
  ): void {
    if (Number.isFinite(tokens) && tokens >= 0) this.estimated.set(sessionId, tokens);
    if (info) this.compactions.set(sessionId, info);
  }

  /** 会话被释放（归档 / 删除 / 重建）时丢掉该会话的缓存与估算，避免键无限累积 */
  forget(sessionId: string): void {
    this.cache.delete(sessionId);
    this.estimated.delete(sessionId);
    this.compactions.delete(sessionId);
    this.budgets.delete(sessionId);
  }

  /**
   * 全局汇总：总量、工具调用次数、按模型 / 按会话两个维度，以及仪表盘用的逐日逐周序列、
   * 峰值与活跃度；`days` 缺省为全部时间。
   *
   * 区间按服务端本地日期取「今天往前 N 天」的整日，全部维度都用这一批点算，
   * 所以逐日求和与 `total` 必然相等；`streak` 例外——它是跨区间的历史口径。
   */
  summary(days?: number): StatsSummaryResponse {
    const now = Date.now();
    const dates = days ? dateKeysOf(now, days) : null;
    const startMs = dates?.[0] ? startOfDayMsOfKey(dates[0]) : 0;
    // 不带 days 时不设上界：全部时间口径下逐日只输出有活动的日子，不会被零值撑爆
    const endMs = dates ? nextDayStartMs(now) : Number.MAX_SAFE_INTEGER;
    const inRange = (point: UsagePoint): boolean => point.timeMs >= startMs && point.timeMs < endMs;

    const all: UsagePoint[] = [];
    const perSession: Array<{ record: SessionRecord; points: UsagePoint[] }> = [];
    for (const record of this.sessions.list()) {
      const points = this.pointsOf(record);
      if (points.length === 0) continue;
      all.push(...points);
      perSession.push({ record, points: points.filter(inRange) });
    }

    const daily = dailyBuckets(
      perSession.flatMap((entry) => entry.points),
      dates ?? undefined,
    );
    const total = emptyTotals();
    const byModel = new Map<string, ModelUsage>();
    const bySession: SessionUsageEntry[] = [];
    let toolCalls = 0;

    for (const { record, points } of perSession) {
      const aggregateOfSession = aggregate(points);
      if (aggregateOfSession.totals.totalTokens === 0 && aggregateOfSession.toolCalls === 0)
        continue;

      addInto(total, aggregateOfSession.totals);
      toolCalls += aggregateOfSession.toolCalls;
      bySession.push({
        sessionId: record.id,
        name: record.name,
        kind: kindOf(record),
        deletedAt: record.deletedAt,
        totals: aggregateOfSession.totals,
      });

      for (const model of aggregateOfSession.byModel) {
        const key = `${model.provider}/${model.model}`;
        const existing = byModel.get(key);
        if (existing) addInto(existing.totals, model.totals);
        else byModel.set(key, { ...model, totals: { ...model.totals } });
      }
    }

    bySession.sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);

    return {
      total,
      toolCalls,
      byModel: [...byModel.values()].sort((a, b) => b.totals.totalTokens - a.totals.totalTokens),
      bySession,
      daily,
      weekly: weeklyBuckets(daily),
      streak: streaksOf(all, localDateKeyOf(now)),
      peak: peakDayOf(daily),
      longestSessionMs: maxChatDurationMs(perSession.map((entry) => entry.points)),
    };
  }

  /** 读取会话文件的用量点，按 mtime 缓存；文件未落盘或读失败时保留上一次结果 */
  private cachedOf(record: SessionRecord): CachedSessionUsage | null {
    const path = record.sourcePath;
    if (!path) return null;

    let mtimeMs: number;
    try {
      if (!existsSync(path)) return null;
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return null;
    }

    const cached = this.cache.get(record.id);
    if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached;

    try {
      const manager = SessionManager.open(path);
      const entry: CachedSessionUsage = {
        path,
        mtimeMs,
        points: collectPoints(manager.getEntries()),
        contextTokens: contextTokensOfBranch(manager),
      };
      this.cache.set(record.id, entry);
      return entry;
    } catch (error) {
      // 会话正在写、末行截断等都可能读失败：展示路径不能被打断，沿用上一次结果
      logger.warn({ sessionId: record.id, error }, "读取会话用量失败");
      return cached ?? null;
    }
  }

  private pointsOf(record: SessionRecord): UsagePoint[] {
    return this.cachedOf(record)?.points ?? [];
  }
}
