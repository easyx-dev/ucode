/**
 * 使用统计的门面：读会话文件（按 mtime 缓存）、按会话现取用量，并给出全局汇总。
 *
 * 解析在 `parse.ts`、纯派生在 `aggregate.ts`、上下文占用的运行期状态在 `context.ts`；
 * 这里只管「数据从哪来、缓存怎么失效」，不自己解析条目，也不做分桶计算。
 * 口径与 pi 的 `getSessionStats()` 一致（合计 = input + output + cacheRead + cacheWrite），不计成本。
 */
import { existsSync, statSync } from "node:fs";

import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  ContextUsage,
  ModelUsage,
  SessionUsageEntry,
  SessionUsageKind,
  StatsSummaryResponse,
  UsageTotals,
} from "@ucode/contracts";

import type { SessionRecord, SessionRepository } from "../../../db/session-repository";
import { logger } from "../../../platform/logger";
import {
  addInto,
  aggregatePoints,
  aggregateSteps,
  dailyBuckets,
  dateKeysOf,
  emptyTotals,
  localDateKeyOf,
  maxChatDurationMs,
  nextDayStartMs,
  peakDayOf,
  type StepPoint,
  startOfDayMsOfKey,
  stepBuckets,
  streaksOf,
  type UsagePoint,
  weeklyBuckets,
} from "./aggregate";
import { ContextState } from "./context";
import { collectPoints, collectSteps, contextTokensOfBranch } from "./parse";

/** 把条目直接聚合成用量；服务内部按文件 mtime 缓存的是用量点，这里供测试与一次性读取 */
export const collectUsage = (entries: Parameters<typeof collectPoints>[0], sinceMs?: number) =>
  aggregatePoints(collectPoints(entries), sinceMs);

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
  /** 步级样本：与用量点同一批条目里解析出来，跟着同一份缓存走 */
  steps: StepPoint[];
  /** 解析出的上下文占用 token 数；拿不到可信基准时为 null（见 `parse.ts` 的 `contextTokensOfBranch`） */
  contextTokens: number | null;
};

/**
 * 会话用量读取与全局汇总。
 * 只依赖仓储（列会话）、模型窗口解析器与文件系统；会话文件未变化时复用缓存，文件读取失败时保留上一次结果。
 */
export class UsageService {
  private readonly cache = new Map<string, CachedSessionUsage>();
  /** 上下文占用的运行期状态（估算 / 最近一次压缩 / 触发点） */
  private readonly context: ContextState;

  constructor(
    private readonly sessions: SessionRepository,
    /** 解析 `provider/model` 的上下文窗口；解析不到为 null（运行时相关，由装配层注入） */
    contextWindowOf: (modelRef: string | null) => number | null,
    /** 该模型的压缩触发点（与装配层注入 pi 的阈值同源）；解析不到为 null */
    contextBudgetOf: (modelRef: string | null) => number | null = () => null,
  ) {
    this.context = new ContextState({ contextWindowOf, contextBudgetOf });
  }

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
    return aggregatePoints(points, options.sinceMs).totals;
  }

  /**
   * 某个时间点之后的工具调用次数；目标轮的「本轮工具调用数」用它。
   *
   * 步级记录（`STEP_RECORD_CUSTOM_TYPE`）是唯一带工具调用数的来源：它按模型往返各记一次。
   * 传 `sinceMs` 即从一轮的起点（目标的 `turnStartedAt`）往后数；不传就是全程。
   */
  toolCallsOf(
    record: SessionRecord,
    options: { live?: AgentSession | undefined; sinceMs?: number } = {},
  ): number {
    const steps = options.live
      ? collectSteps(options.live.sessionManager.getEntries())
      : (this.cachedOf(record)?.steps ?? []);
    const sinceMs = options.sinceMs;
    return steps.reduce(
      (sum, step) => (sinceMs === undefined || step.at >= sinceMs ? sum + step.toolCalls : sum),
      0,
    );
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
    return this.context.usageOf(record.id, record.model, {
      window: piUsage?.contextWindow ?? null,
      tokens: options.live
        ? (piUsage?.tokens ?? null)
        : (this.cachedOf(record)?.contextTokens ?? null),
    });
  }

  /** 记下装配时算出的压缩触发点；与注入 pi 的阈值同源，见 `harness/setup/budget` */
  rememberBudget(sessionId: string, triggerTokens: number): void {
    this.context.rememberBudget(sessionId, triggerTokens);
  }

  /** 记下一次压缩的结果：压缩后的估算规模 + 发生原因 */
  rememberCompaction(
    sessionId: string,
    tokens: number,
    info?: { reason: string; at: number },
  ): void {
    this.context.rememberCompaction(sessionId, tokens, info);
  }

  /** 会话被释放（归档 / 删除 / 重建）时丢掉该会话的缓存与瞬时值，避免键无限累积 */
  forget(sessionId: string): void {
    this.cache.delete(sessionId);
    this.context.forget(sessionId);
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
    const allSteps: StepPoint[] = [];
    const perSession: Array<{ record: SessionRecord; points: UsagePoint[] }> = [];
    for (const record of this.sessions.list()) {
      const cached = this.cachedOf(record);
      const points = cached?.points ?? [];
      // 步级样本可能比用量点多（比如只有工具调用的步不进用量点），所以两种情况都要看
      const steps = cached?.steps ?? [];
      if (points.length === 0 && steps.length === 0) continue;
      all.push(...points);
      allSteps.push(...steps.filter((step) => step.at >= startMs && step.at < endMs));
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
      const aggregateOfSession = aggregatePoints(points);
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
      steps: {
        total: aggregateSteps(allSteps),
        byModel: stepBuckets(allSteps, (step) =>
          step.model ? `${step.provider ?? ""}/${step.model}` : null,
        ).sort((a, b) => b.totals.steps - a.totals.steps),
        byThinking: stepBuckets(allSteps, (step) => step.thinkingLevel ?? "unknown").sort(
          (a, b) => b.totals.steps - a.totals.steps,
        ),
        daily: stepBuckets(allSteps, (step) => localDateKeyOf(step.at)).sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        ),
      },
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
      const entries = manager.getEntries();
      const entry: CachedSessionUsage = {
        path,
        mtimeMs,
        points: collectPoints(entries),
        steps: collectSteps(entries),
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
