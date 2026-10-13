/**
 * 用量仪表盘纯计算的单测：日历网格排版、热力分档与时长拆分。
 *
 * 重点覆盖跨月 / 跨年、区间首尾落在周中、单日区间与空数据这些容易错位的边界。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UsageDayBucket, UsageWeekBucket } from "@ucode/contracts";

import {
  buildCalendar,
  cacheHitRate,
  dateKeyOfIndex,
  dayIndexOf,
  durationParts,
  formatMs,
  levelOf,
  ratioLabel,
  weekStartKeyOf,
} from "../usage-series";

const totalsOf = (totalTokens: number) => ({
  inputTokens: totalTokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens,
});

const day = (date: string, totalTokens: number, messages = 1): UsageDayBucket => ({
  date,
  messages,
  totals: totalsOf(totalTokens),
});

const week = (weekStart: string, totalTokens: number): UsageWeekBucket => ({
  weekStart,
  messages: 1,
  totals: totalsOf(totalTokens),
});

/** 连续若干天的零值日，便于构造区间 */
const days = (from: string, count: number): UsageDayBucket[] =>
  Array.from({ length: count }, (_, index) => {
    const date = dateKeyOfIndex(dayIndexOf(from) + index);
    return day(date, 0, 0);
  });

describe("日期换算", () => {
  it("天序号与日期互转可逆", () => {
    for (const key of ["2025-12-29", "2026-01-01", "2026-02-28", "2026-03-01"]) {
      assert.equal(dateKeyOfIndex(dayIndexOf(key)), key);
    }
  });

  it("周一为周起点：周日归到上一周", () => {
    assert.equal(weekStartKeyOf("2026-01-05"), "2026-01-05");
    assert.equal(weekStartKeyOf("2026-01-04"), "2025-12-29");
    assert.equal(weekStartKeyOf("1970-01-04"), "1969-12-29");
  });
});

describe("levelOf", () => {
  it("无用量为 0，其余按最大值四等分、向上取整", () => {
    assert.equal(levelOf(0, 100), 0);
    assert.equal(levelOf(5, 0), 0);
    assert.equal(levelOf(1, 100), 1);
    assert.equal(levelOf(25, 100), 1);
    assert.equal(levelOf(26, 100), 2);
    assert.equal(levelOf(51, 100), 3);
    assert.equal(levelOf(100, 100), 4);
    assert.equal(levelOf(1_000_000, 100), 4);
  });
});

describe("durationParts", () => {
  it("拆成天 / 时 / 分 / 秒，负数按 0", () => {
    assert.deepEqual(durationParts(0), { days: 0, hours: 0, minutes: 0, seconds: 0 });
    assert.deepEqual(durationParts(59_000), { days: 0, hours: 0, minutes: 0, seconds: 59 });
    assert.deepEqual(durationParts(60_000), { days: 0, hours: 0, minutes: 1, seconds: 0 });
    assert.deepEqual(durationParts(3_600_000), { days: 0, hours: 1, minutes: 0, seconds: 0 });
    assert.deepEqual(durationParts(90_060_000), { days: 1, hours: 1, minutes: 1, seconds: 0 });
    assert.deepEqual(durationParts(-1), { days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("buildCalendar", () => {
  it("空数据得到空网格", () => {
    assert.deepEqual(buildCalendar([], [], "day"), { columns: [], max: 0 });
  });

  it("单日区间：一列七行，只有那一天有格子", () => {
    // 2026-01-07 是周三
    const calendar = buildCalendar([day("2026-01-07", 42)], [], "day");
    assert.equal(calendar.columns.length, 1);
    assert.equal(calendar.max, 42);
    const column = calendar.columns[0];
    assert.equal(column?.weekStart, "2026-01-05");
    assert.equal(column?.month, null);
    assert.deepEqual(
      column?.cells.map((cell) => cell?.date ?? null),
      [null, null, "2026-01-07", null, null, null, null],
    );
    assert.equal(column?.cells[2]?.level, 4);
  });

  it("跨月时在含 1 号的那一列标出月份，跨年同样成立", () => {
    const calendar = buildCalendar(days("2025-12-29", 7), [], "day");
    assert.equal(calendar.columns.length, 1);
    // 2026-01-01 落在 2025-12-29 那一列里
    assert.equal(calendar.columns[0]?.month, 1);
    assert.equal(calendar.columns[0]?.cells[3]?.date, "2026-01-01");

    const twoMonths = buildCalendar(days("2026-01-21", 14), [], "day");
    assert.deepEqual(
      twoMonths.columns.map((column) => column.month),
      [null, 2, null],
    );
  });

  it("首尾落在周中时，区间外的格子用 null 占位保证行对齐", () => {
    // 2026-01-07（周三）到 2026-01-13（周二）→ 两列
    const calendar = buildCalendar(days("2026-01-07", 7), [], "day");
    assert.equal(calendar.columns.length, 2);
    assert.deepEqual(
      calendar.columns[0]?.cells.map((cell) => cell?.date ?? null),
      [null, null, "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"],
    );
    assert.deepEqual(
      calendar.columns[1]?.cells.map((cell) => cell?.date ?? null),
      ["2026-01-12", "2026-01-13", null, null, null, null, null],
    );
  });

  it("累计模式逐日递增，周模式整列取所在周的量", () => {
    const daily = [day("2026-01-05", 10), day("2026-01-06", 20), day("2026-01-07", 0)];
    const weekly = [week("2026-01-05", 30)];

    const cumulative = buildCalendar(daily, weekly, "total");
    assert.deepEqual(
      cumulative.columns[0]?.cells.slice(0, 3).map((cell) => cell?.value),
      [10, 30, 30],
    );

    const byWeek = buildCalendar(daily, weekly, "week");
    assert.deepEqual(
      byWeek.columns[0]?.cells.slice(0, 3).map((cell) => cell?.value),
      [30, 30, 30],
    );

    const byDay = buildCalendar(daily, weekly, "day");
    assert.deepEqual(
      byDay.columns[0]?.cells.slice(0, 3).map((cell) => cell?.value),
      [10, 20, 0],
    );
    assert.equal(byDay.max, 20);
  });

  it("消息轮次随当日数据带出，与模式无关", () => {
    const calendar = buildCalendar([day("2026-01-05", 10, 3)], [], "total");
    assert.equal(calendar.columns[0]?.cells[0]?.messages, 3);
  });
});

describe("cacheHitRate", () => {
  it("分母为 0 时不给比率（与「全没命中」区分开）", () => {
    assert.equal(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 }), undefined);
  });

  it("全没命中为 0，全命中为 1", () => {
    assert.equal(cacheHitRate({ inputTokens: 120, cacheReadTokens: 0 }), 0);
    assert.equal(cacheHitRate({ inputTokens: 0, cacheReadTokens: 80 }), 1);
  });

  it("按「命中读 / (未命中输入 + 命中读)」算，缓存写入不进分母", () => {
    assert.equal(cacheHitRate({ inputTokens: 30, cacheReadTokens: 70 }), 0.7);
  });

  it("文案保留一位小数，没有比率时给占位符", () => {
    assert.equal(ratioLabel(0.7), "70.0%");
    assert.equal(ratioLabel(0), "0.0%");
    assert.equal(ratioLabel(undefined), "—");
    assert.equal(ratioLabel(null), "—");
  });

  it("毫秒文案：一秒以内给毫秒，往上给一位小数的秒", () => {
    assert.equal(formatMs(850), "850ms");
    assert.equal(formatMs(1_234), "1.2s");
    assert.equal(formatMs(null), "—");
  });
});
