/**
 * 用量的纯计算：token 合计工具、逐日 / 逐周分桶、活跃与连续天数、会话时长。
 *
 * 只吃「时间 + token 合计」的用量点，不碰文件与 pi 条目（解析在 `parse.ts`，读盘在 `index.ts`）。
 * 日期一律按服务端本地时区切分；天数间隔用天序号推导，避免夏令时把一天算成 23 或 25 小时。
 */
import type {
  ModelUsage,
  StepUsageBucket,
  StepUsageTotals,
  UsageDayBucket,
  UsagePeakDay,
  UsageStreak,
  UsageTotals,
  UsageWeekBucket,
} from "@ucode/contracts";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 相邻用量点间隔超过它就不再算同一段连续聊天 */
export const IDLE_GAP_MS = 30 * 60 * 1000;

export const emptyTotals = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
});

export const addInto = (target: UsageTotals, usage: UsageTotals): void => {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheWriteTokens += usage.cacheWriteTokens;
  target.totalTokens += usage.totalTokens;
};

/** 分桶 / 连续天数 / 时长用得到的用量点；模型名与工具次数与本模块无关 */
export type SeriesPoint = {
  timeMs: number;
  totals: UsageTotals;
};

/** 一次 LLM 调用 / 一条 `usage` 条目解析出的用量点（`parse.ts` 的产物） */
export type UsagePoint = SeriesPoint & {
  provider: string | null;
  model: string | null;
  /** 该次回答里的工具调用数 */
  toolCalls: number;
};

export type Aggregate = {
  totals: UsageTotals;
  byModel: ModelUsage[];
  toolCalls: number;
};

/** 聚合用量点；`sinceMs` 非空时只统计其后的点，按模型归并并按总量降序 */
export const aggregatePoints = (points: readonly UsagePoint[], sinceMs?: number): Aggregate => {
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

/** 本地时区的 `YYYY-MM-DD` */
export const localDateKeyOf = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 本地零点的时间戳 */
export const startOfDayMs = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** `YYYY-MM-DD` → 天序号（按 UTC 零点计），用于跨月 / 跨年的间隔与连续判断 */
export const dayIndexOf = (dateKey: string): number =>
  Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / MS_PER_DAY);

/** 天序号 → `YYYY-MM-DD` */
export const dateKeyOfIndex = (index: number): string =>
  new Date(index * MS_PER_DAY).toISOString().slice(0, 10);

/** `YYYY-MM-DD` 的本地零点时间戳（不带时区的日期时间串按本地时区解析） */
export const startOfDayMsOfKey = (dateKey: string): number =>
  new Date(`${dateKey}T00:00:00`).getTime();

/** 次日零点（本地） */
export const nextDayStartMs = (ms: number): number => {
  const date = new Date(startOfDayMs(ms));
  date.setDate(date.getDate() + 1);
  return date.getTime();
};

/** 该日所在周的周一（1970-01-01 是周四，故天序号 0 落在周内的第 3 天） */
export const weekStartKeyOf = (dateKey: string): string => {
  const index = dayIndexOf(dateKey);
  const weekday = (((index + 3) % 7) + 7) % 7;
  return dateKeyOfIndex(index - weekday);
};

/**
 * 从 `endMs` 所在日往前数 `count` 天的日期（含当日，升序）。
 * 逐日 `setDate` 而不是减毫秒：夏令时切换日减 24 小时会落回前一天。
 */
export const dateKeysOf = (endMs: number, count: number): string[] => {
  const start = startOfDayMs(endMs);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(start);
    date.setDate(date.getDate() - offset);
    keys.push(localDateKeyOf(date.getTime()));
  }
  return keys;
};

/**
 * 逐日分桶。
 *
 * `dates` 给出要覆盖的日期（升序）时，区间内无活动的日子也补成 0，且区间外的点被丢弃；
 * 不给 `dates` 时（全部时间口径）只输出有活动的日子。两种情况都与 `total` 同口径（同一批点）。
 */
export const dailyBuckets = (
  points: ReadonlyArray<SeriesPoint>,
  dates?: ReadonlyArray<string>,
): UsageDayBucket[] => {
  const byDate = new Map<string, UsageDayBucket>();
  const order: string[] = [];
  if (dates) {
    for (const date of dates) {
      byDate.set(date, { date, totals: emptyTotals(), messages: 0 });
      order.push(date);
    }
  }

  for (const point of points) {
    const date = localDateKeyOf(point.timeMs);
    let bucket = byDate.get(date);
    if (!bucket) {
      if (dates) continue;
      bucket = { date, totals: emptyTotals(), messages: 0 };
      byDate.set(date, bucket);
      order.push(date);
    }
    addInto(bucket.totals, point.totals);
    bucket.messages += 1;
  }

  return (
    order
      .flatMap((date) => {
        const bucket = byDate.get(date);
        return bucket ? [bucket] : [];
      })
      // 不给 `dates` 时顺序取决于会话遍历顺序，按 `YYYY-MM-DD` 升序（字典序即时间序）归一
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  );
};

/** 逐周分桶：把逐日结果按周一归并（跨月的那一周按周内落在区间内的日子累计） */
export const weeklyBuckets = (daily: ReadonlyArray<UsageDayBucket>): UsageWeekBucket[] => {
  const byWeek = new Map<string, UsageWeekBucket>();
  const order: string[] = [];
  for (const day of daily) {
    const weekStart = weekStartKeyOf(day.date);
    let bucket = byWeek.get(weekStart);
    if (!bucket) {
      bucket = { weekStart, totals: emptyTotals(), messages: 0 };
      byWeek.set(weekStart, bucket);
      order.push(weekStart);
    }
    addInto(bucket.totals, day.totals);
    bucket.messages += day.messages;
  }
  return order.flatMap((weekStart) => {
    const bucket = byWeek.get(weekStart);
    return bucket ? [bucket] : [];
  });
};

/**
 * 活跃天与连续天数；`todayKey` 由调用方给出，便于按固定日期测试。
 *
 * 「当前连续」要求最新活跃日是今天或昨天——更早说明已经断了，从 0 重新数。
 */
export const streaksOf = (points: ReadonlyArray<SeriesPoint>, todayKey: string): UsageStreak => {
  const indexes = [
    ...new Set(points.map((point) => dayIndexOf(localDateKeyOf(point.timeMs)))),
  ].sort((a, b) => a - b);
  if (indexes.length === 0) return { current: 0, longest: 0, activeDays: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < indexes.length; i += 1) {
    run = indexes[i] === (indexes[i - 1] ?? 0) + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = dayIndexOf(todayKey);
  const last = indexes[indexes.length - 1] ?? today;
  const connected = last === today || last === today - 1;

  return { current: connected ? run : 0, longest, activeDays: indexes.length };
};

/**
 * 单会话的聊天时长（毫秒）：按间隔切段后各段时长累加。
 *
 * 段时长取段内首末两点之差，单点段为 0——它只说明「那会儿调用过一次」，撑不出时长。
 */
export const chatDurationMs = (points: ReadonlyArray<SeriesPoint>): number => {
  if (points.length === 0) return 0;
  const times = points.map((point) => point.timeMs).sort((a, b) => a - b);
  let total = 0;
  let segmentStart = times[0] ?? 0;
  let previous = segmentStart;
  for (let i = 1; i < times.length; i += 1) {
    const time = times[i] ?? previous;
    if (time - previous > IDLE_GAP_MS) {
      total += previous - segmentStart;
      segmentStart = time;
    }
    previous = time;
  }
  return total + previous - segmentStart;
};

/** 多会话中最长的聊天时长；空集合为 0 */
export const maxChatDurationMs = (groups: ReadonlyArray<ReadonlyArray<SeriesPoint>>): number =>
  groups.reduce((max, points) => Math.max(max, chatDurationMs(points)), 0);

/** 区间内 token 最高的那一天；没有用量时为 null（并列取最早的一天） */
export const peakDayOf = (daily: ReadonlyArray<UsageDayBucket>): UsagePeakDay | null => {
  let peak: UsagePeakDay | null = null;
  for (const day of daily) {
    const totalTokens = day.totals.totalTokens;
    if (totalTokens <= 0) continue;
    if (!peak || totalTokens > peak.totalTokens) peak = { date: day.date, totalTokens };
  }
  return peak;
};

/**
 * 一个步级样本：每步耗时记录里聚合用得到的部分（解析在 `parse.ts`）。
 * `totalMs` 已换算成毫秒时长；四个分段可能为空（中断轮没有首帧锚点）。
 */
export type StepPoint = {
  /** 该步结束时刻（毫秒时间戳），区间过滤按它算 */
  at: number;
  /** 用户轮序号，由会话池推进；0 表示这条记录没有轮序号（老记录） */
  userTurn: number;
  provider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  /** 以失败 / 中断收尾 */
  failed: boolean;
  toolCalls: number;
  totalMs: number;
  firstEventMs: number | null;
  ttftMs: number | null;
  streamMs: number | null;
  toolMs: number | null;
  userWaitMs: number;
  inputTokens: number;
  cacheReadTokens: number;
};

/** 最近秩分位：升序取第 ceil(p × n) 个（n=4、p=0.5 → 第 2 个）；空集合给 null */
const percentileOf = (sorted: readonly number[], p: number): number | null =>
  sorted.length === 0 ? null : (sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null);

const meanOf = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** 比值：分母为 0 时给 null（「没有数据」与「占比为 0」是两回事） */
const shareOf = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

const emptyStepTotals = (): StepUsageTotals => ({
  steps: 0,
  turns: 0,
  stepsPerTurn: null,
  avgStepMs: null,
  p50StepMs: null,
  p90StepMs: null,
  avgFirstEventMs: null,
  avgTtftMs: null,
  ttftShare: null,
  toolShare: null,
  toolCalls: 0,
  failedSteps: 0,
  cacheHitRate: null,
});

/**
 * 步级聚合。
 *
 * 「纯工具耗时」= `toolMs - userWaitMs` 并按下界 0 夹一下：`toolMs` 是 `message_end → turn_end`，
 * 其中包含等用户的时间，而等待起止可能跨轮（`userWaitMs` 会结转），不减就把等用户算成工具时间。
 * 首帧占比取「含排队的累计首帧延迟」：`firstEventMs + ttftMs`。
 */
export const aggregateSteps = (points: readonly StepPoint[]): StepUsageTotals => {
  const totals = emptyStepTotals();
  if (points.length === 0) return totals;

  const durations: number[] = [];
  const firstEvents: number[] = [];
  const ttfts: number[] = [];
  const turns = new Set<number>();
  let totalMs = 0;
  let firstTokenMs = 0;
  let toolMs = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;

  for (const point of points) {
    totals.steps += 1;
    totals.toolCalls += point.toolCalls;
    if (point.failed) totals.failedSteps += 1;
    turns.add(point.userTurn);
    durations.push(point.totalMs);
    totalMs += point.totalMs;
    if (point.firstEventMs !== null) firstEvents.push(point.firstEventMs);
    if (point.ttftMs !== null) ttfts.push(point.ttftMs);
    firstTokenMs += (point.firstEventMs ?? 0) + (point.ttftMs ?? 0);
    if (point.toolMs !== null) toolMs += Math.max(0, point.toolMs - point.userWaitMs);
    inputTokens += point.inputTokens;
    cacheReadTokens += point.cacheReadTokens;
  }

  const sorted = [...durations].sort((a, b) => a - b);
  totals.turns = turns.size;
  totals.stepsPerTurn = turns.size > 0 ? totals.steps / turns.size : null;
  totals.avgStepMs = meanOf(durations);
  totals.p50StepMs = percentileOf(sorted, 0.5);
  totals.p90StepMs = percentileOf(sorted, 0.9);
  totals.avgFirstEventMs = meanOf(firstEvents);
  totals.avgTtftMs = meanOf(ttfts);
  totals.ttftShare = shareOf(firstTokenMs, totalMs);
  totals.toolShare = shareOf(toolMs, totalMs);
  totals.cacheHitRate = shareOf(cacheReadTokens, inputTokens + cacheReadTokens);
  return totals;
};

/**
 * 按 `keyOf` 分桶聚合；桶序由首次出现顺序决定，调用方要别的顺序就自己排。
 * `keyOf` 返回 null 表示这条不进任何桶（比如模型不明的步）。
 */
export const stepBuckets = (
  points: readonly StepPoint[],
  keyOf: (point: StepPoint) => string | null,
): StepUsageBucket[] => {
  const grouped = new Map<string, StepPoint[]>();
  for (const point of points) {
    const key = keyOf(point);
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(point);
    else grouped.set(key, [point]);
  }
  return [...grouped.entries()].map(([key, group]) => ({ key, totals: aggregateSteps(group) }));
};
