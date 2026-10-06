/**
 * 用量纯计算的单测：日期分桶、连续天数与会话时长。
 *
 * 日期都按本地时区取，用例用「今天」相对偏移造点，避免写死日期后随运行环境失效；
 * 跨月 / 跨年 / 单日 / 空数据这些边界单独覆盖。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UsageDayBucket } from "@ucode/contracts";

import {
  chatDurationMs,
  dailyBuckets,
  dateKeyOfIndex,
  dateKeysOf,
  dayIndexOf,
  localDateKeyOf,
  MS_PER_DAY,
  maxChatDurationMs,
  peakDayOf,
  startOfDayMs,
  streaksOf,
  weeklyBuckets,
  weekStartKeyOf,
} from "../aggregate";

/** 一个只有 input 的用量点，便于按 token 数直接断言 */
const point = (timeMs: number, tokens: number) => ({
  timeMs,
  totals: {
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: tokens,
  },
});

/** 指定「几天前的某个整点」，本地时区（夏令时切换日也落在期望的日期上） */
const atDaysAgo = (days: number, hour: number, minute = 0): number => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
};

const dayBucket = (date: string, tokens: number, messages = 1): UsageDayBucket => ({
  date,
  messages,
  totals: {
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: tokens,
  },
});

describe("日期换算", () => {
  it("天序号与日期互转可逆，且跨月跨年连续", () => {
    for (const key of ["2026-01-05", "2026-02-28", "2025-12-31", "2026-03-01"]) {
      assert.equal(dateKeyOfIndex(dayIndexOf(key)), key);
    }
    assert.equal(dayIndexOf("2026-03-01") - dayIndexOf("2026-02-28"), 1);
    assert.equal(dayIndexOf("2026-01-01") - dayIndexOf("2025-12-31"), 1);
  });

  it("周一为一周起点：周日归到上一周，周一归到自己", () => {
    // 2026-01-05 是周一，2026-01-04 是周日
    assert.equal(weekStartKeyOf("2026-01-05"), "2026-01-05");
    assert.equal(weekStartKeyOf("2026-01-04"), "2025-12-29");
    assert.equal(weekStartKeyOf("2026-01-11"), "2026-01-05");
    assert.equal(weekStartKeyOf("1970-01-04"), "1969-12-29");
  });

  it("dateKeysOf 含当日且升序，跨月跨年不丢日", () => {
    const end = new Date(2026, 2, 2, 23, 30).getTime();
    assert.deepEqual(dateKeysOf(end, 1), ["2026-03-02"]);
    assert.deepEqual(dateKeysOf(end, 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
    assert.deepEqual(dateKeysOf(new Date(2026, 0, 2, 0, 0).getTime(), 4), [
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("日期取本地的日界，startOfDayMs 抹掉时分秒", () => {
    const noon = new Date(2026, 2, 2, 12, 34, 56).getTime();
    assert.equal(localDateKeyOf(noon), "2026-03-02");
    assert.equal(startOfDayMs(noon), new Date(2026, 2, 2, 0, 0, 0, 0).getTime());
  });
});

describe("dailyBuckets", () => {
  it("给定日期时补齐零值日，区间外的点丢弃", () => {
    const dates = ["2026-03-01", "2026-03-02", "2026-03-03"];
    const buckets = dailyBuckets(
      [
        point(new Date(2026, 2, 1, 10, 0).getTime(), 10),
        point(new Date(2026, 2, 1, 11, 0).getTime(), 5),
        point(new Date(2026, 2, 3, 9, 0).getTime(), 7),
        point(new Date(2026, 1, 27, 9, 0).getTime(), 100),
      ],
      dates,
    );

    assert.deepEqual(
      buckets.map((bucket) => [bucket.date, bucket.totals.totalTokens, bucket.messages]),
      [
        ["2026-03-01", 15, 2],
        ["2026-03-02", 0, 0],
        ["2026-03-03", 7, 1],
      ],
    );
  });

  it("不给日期时只输出有活动的日子，且按日期升序", () => {
    const buckets = dailyBuckets([
      point(new Date(2026, 2, 3, 9, 0).getTime(), 7),
      point(new Date(2026, 2, 1, 9, 0).getTime(), 3),
    ]);
    assert.deepEqual(
      buckets.map((bucket) => bucket.date),
      ["2026-03-01", "2026-03-03"],
    );
  });

  it("空数据给日期时全是零值日，不给日期时为空数组", () => {
    assert.equal(dailyBuckets([], ["2026-03-01", "2026-03-02"]).length, 2);
    assert.deepEqual(dailyBuckets([]), []);
  });
});

describe("weeklyBuckets", () => {
  it("按周一归并，并保持升序（跨月那一周累计区间内的日子）", () => {
    const daily = [
      dayBucket("2025-12-29", 1),
      dayBucket("2025-12-30", 2),
      dayBucket("2026-01-01", 4),
      dayBucket("2026-01-05", 8),
    ];
    const weeks = weeklyBuckets(daily);
    assert.deepEqual(
      weeks.map((week) => [week.weekStart, week.totals.totalTokens, week.messages]),
      [
        ["2025-12-29", 7, 3],
        ["2026-01-05", 8, 1],
      ],
    );
  });

  it("空输入得到空数组", () => {
    assert.deepEqual(weeklyBuckets([]), []);
  });
});

describe("streaksOf", () => {
  const today = localDateKeyOf(Date.now());

  it("空数据全为 0", () => {
    assert.deepEqual(streaksOf([], today), { current: 0, longest: 0, activeDays: 0 });
  });

  it("只有今天一条：当前与最长都是 1", () => {
    assert.deepEqual(streaksOf([point(atDaysAgo(0, 10), 1)], today), {
      current: 1,
      longest: 1,
      activeDays: 1,
    });
  });

  it("最新活跃日是昨天时当前连续仍然成立", () => {
    const streak = streaksOf(
      [point(atDaysAgo(1, 10), 1), point(atDaysAgo(2, 10), 1), point(atDaysAgo(3, 10), 1)],
      today,
    );
    assert.deepEqual(streak, { current: 3, longest: 3, activeDays: 3 });
  });

  it("最新活跃日是前天时当前为 0，最长保留", () => {
    const streak = streaksOf(
      [point(atDaysAgo(2, 10), 1), point(atDaysAgo(3, 10), 1), point(atDaysAgo(4, 10), 1)],
      today,
    );
    assert.deepEqual(streak, { current: 0, longest: 3, activeDays: 3 });
  });

  it("中间断开时取最长的连续段，同一天多条只算一天", () => {
    const streak = streaksOf(
      [
        point(atDaysAgo(0, 9), 1),
        point(atDaysAgo(0, 10), 1),
        point(atDaysAgo(1, 10), 1),
        // 缺第 2 天
        point(atDaysAgo(3, 10), 1),
        point(atDaysAgo(4, 10), 1),
        point(atDaysAgo(5, 10), 1),
      ],
      today,
    );
    assert.deepEqual(streak, { current: 2, longest: 3, activeDays: 5 });
  });

  it("跨月跨年连续不被切断", () => {
    const streak = streaksOf(
      [
        point(new Date(2025, 11, 31, 23, 30).getTime(), 1),
        point(new Date(2026, 0, 1, 0, 30).getTime(), 1),
        point(new Date(2026, 0, 2, 0, 30).getTime(), 1),
      ],
      "2026-01-02",
    );
    assert.deepEqual(streak, { current: 3, longest: 3, activeDays: 3 });
  });
});

describe("chatDurationMs", () => {
  it("空会话与单点会话都是 0", () => {
    assert.equal(chatDurationMs([]), 0);
    assert.equal(chatDurationMs([point(atDaysAgo(0, 10), 1)]), 0);
  });

  it("间隔在阈值内累加为一段，无序输入也按时间排序", () => {
    const start = atDaysAgo(0, 9);
    const duration = chatDurationMs([
      point(start + 20 * 60 * 1000, 1),
      point(start, 1),
      point(start + 50 * 60 * 1000, 1),
    ]);
    assert.equal(duration, 50 * 60 * 1000);
  });

  it("超过阈值切成两段，各段时长相加", () => {
    const start = atDaysAgo(0, 9);
    const duration = chatDurationMs([
      point(start, 1),
      point(start + 10 * 60 * 1000, 1),
      // 间隔 40 分钟 > 30 分钟阈值
      point(start + 50 * 60 * 1000, 1),
      point(start + 70 * 60 * 1000, 1),
    ]);
    assert.equal(duration, 10 * 60 * 1000 + 20 * 60 * 1000);
  });

  it("跨天的会话被空闲切断，不把夜里算进时长", () => {
    const duration = chatDurationMs([point(atDaysAgo(1, 23), 1), point(atDaysAgo(0, 1), 1)]);
    assert.equal(duration, 0);
  });

  it("取多会话中的最大值", () => {
    const start = atDaysAgo(0, 9);
    const duration = maxChatDurationMs([
      [point(start, 1)],
      [point(start, 1), point(start + 5 * 60 * 1000, 1)],
      [point(start, 1), point(start + 3 * 60 * 1000, 1)],
    ]);
    assert.equal(duration, 5 * 60 * 1000);
    assert.equal(maxChatDurationMs([]), 0);
  });
});

describe("peakDayOf", () => {
  it("没有用量时为空", () => {
    assert.equal(peakDayOf([]), null);
    assert.equal(peakDayOf([dayBucket("2026-03-01", 0)]), null);
  });

  it("取 token 最高的一天，并列取更早的一天", () => {
    assert.deepEqual(
      peakDayOf([
        dayBucket("2026-03-01", 10),
        dayBucket("2026-03-02", 30, 2),
        dayBucket("2026-03-03", 30),
      ]),
      { date: "2026-03-02", totalTokens: 30 },
    );
  });
});

describe("常量", () => {
  it("一天正好是 MS_PER_DAY 毫秒", () => {
    assert.equal(MS_PER_DAY, 24 * 60 * 60 * 1000);
  });
});
