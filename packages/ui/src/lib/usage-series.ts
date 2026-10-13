/**
 * 用量仪表盘的纯计算：日历热力图的网格 / 分档与时长拆分。
 *
 * 只吃契约里的逐日 / 逐周序列，不碰 DOM 与 i18n，便于单测。
 * 日期同样按本地时区处理，与 `@ucode/server` 的分桶口径一致。
 */

import type { UsageDayBucket, UsageTotals, UsageWeekBucket } from "./types";

/** 热力图的取值口径：当日 / 所在周 / 区间起点到当日的累计 */
export type HeatMode = "day" | "week" | "total";

/** 热力图的一格 */
export type HeatCell = {
  date: string;
  /** 该格展示的 token 数（随模式变化） */
  value: number;
  /** 当日的调用次数 */
  messages: number;
  /** 0（无用量）到 4（最高档） */
  level: number;
};

/** 热力图的一列 = 一个自然周（周一 → 周日）；区间外的日子为 null，占位保证行对齐 */
export type CalendarColumn = {
  weekStart: string;
  /** 该列若含某月 1 号，给出月份（1-12）作为月份轴标签 */
  month: number | null;
  cells: ReadonlyArray<HeatCell | null>;
};

export type Calendar = {
  columns: CalendarColumn[];
  /** 区间内的单格最大值，用于图例与分档 */
  max: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → 天序号（按 UTC 零点计），跨月 / 跨年连续 */
export const dayIndexOf = (dateKey: string): number =>
  Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / MS_PER_DAY);

/** 天序号 → `YYYY-MM-DD` */
export const dateKeyOfIndex = (index: number): string =>
  new Date(index * MS_PER_DAY).toISOString().slice(0, 10);

/** 该日所在周的周一（1970-01-01 是周四，故天序号 0 落在周内的第 3 天） */
export const weekStartKeyOf = (dateKey: string): string => {
  const index = dayIndexOf(dateKey);
  const weekday = (((index + 3) % 7) + 7) % 7;
  return dateKeyOfIndex(index - weekday);
};

/** 热力分档：无用量为 0，其余按最大值四等分（向上取整，1 档起步） */
export const levelOf = (value: number, max: number): number => {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
};

/**
 * 缓存命中率：命中读 /（未命中输入 + 命中读）。
 *
 * 口径与 `calculateContextTokens` 一致（`input + cacheRead` 是输入侧规模，即 `input` 是未命中那部分）；
 * `cacheWriteTokens` 属成本侧，不进分母。分母为 0 时不给比率——「没有输入」与「全没命中」是两回事。
 */
export const cacheHitRate = (
  totals: Pick<UsageTotals, "inputTokens" | "cacheReadTokens">,
): number | undefined => {
  const denominator = totals.inputTokens + totals.cacheReadTokens;
  if (denominator <= 0) return undefined;
  return totals.cacheReadTokens / denominator;
};

/**
 * 占比文案（0-1 的比值 → 一位小数百分比）；没有比率时用占位符——
 * 「分母为 0」与「占比为 0」不能长成一个样。
 */
export const ratioLabel = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

/** 毫秒文案：一秒以内给整毫秒，往上给一位小数的秒；拿不到数给占位符 */
export const formatMs = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  return value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`;
};

/** 毫秒拆成天 / 时 / 分 / 秒；负数按 0 处理 */
export const durationParts = (
  ms: number,
): { days: number; hours: number; minutes: number; seconds: number } => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
};

/** 每格的取值：日模式取当日、周模式取所在周、累计模式取区间起点到当日的累加 */
const heatValuesOf = (
  daily: ReadonlyArray<UsageDayBucket>,
  weekly: ReadonlyArray<UsageWeekBucket>,
  mode: HeatMode,
): Map<string, number> => {
  const values = new Map<string, number>();
  if (mode === "week") {
    const byWeek = new Map(weekly.map((week) => [week.weekStart, week.totals.totalTokens]));
    for (const day of daily) {
      values.set(day.date, byWeek.get(weekStartKeyOf(day.date)) ?? day.totals.totalTokens);
    }
    return values;
  }

  let running = 0;
  for (const day of daily) {
    if (mode === "total") running += day.totals.totalTokens;
    values.set(day.date, mode === "total" ? running : day.totals.totalTokens);
  }
  return values;
};

/** 该列里的月份标签：有当月 1 号就标这一个月，否则不标 */
const monthOfColumn = (cells: ReadonlyArray<HeatCell | null>): number | null => {
  for (const cell of cells) {
    if (cell?.date.endsWith("-01")) return Number(cell.date.slice(5, 7));
  }
  return null;
};

/**
 * 把逐日序列摆成日历网格。
 *
 * 第一列是首个日期所在周的周一，往后每周一列，每列固定 7 行（周一到周日）；
 * 区间开始前与结束后的格子为 null，只占位不渲染内容，保证行对齐与月份轴正确。
 */
export const buildCalendar = (
  daily: ReadonlyArray<UsageDayBucket>,
  weekly: ReadonlyArray<UsageWeekBucket>,
  mode: HeatMode,
): Calendar => {
  const first = daily[0];
  const last = daily[daily.length - 1];
  if (!first || !last) return { columns: [], max: 0 };

  const values = heatValuesOf(daily, weekly, mode);
  const max = [...values.values()].reduce((peak, value) => Math.max(peak, value), 0);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const lastIndex = dayIndexOf(last.date);
  const columns: CalendarColumn[] = [];

  for (let start = dayIndexOf(weekStartKeyOf(first.date)); start <= lastIndex; start += 7) {
    const cells: Array<HeatCell | null> = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const index = start + offset;
      const date = dateKeyOfIndex(index);
      const day = index <= lastIndex ? byDate.get(date) : undefined;
      if (!day) {
        cells.push(null);
        continue;
      }
      const value = values.get(date) ?? 0;
      cells.push({ date, value, messages: day.messages, level: levelOf(value, max) });
    }
    columns.push({ weekStart: dateKeyOfIndex(start), month: monthOfColumn(cells), cells });
  }

  return { columns, max };
};
