import type { MigrationPreflight, UsageSummary } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  describeBucket,
  describePreflight,
  describeVersions,
  formatTokenCount,
  topModelRows,
} from "./insights-format.ts";

const summary: UsageSummary = {
  totals: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 },
  byModel: [
    {
      key: "deepseek/m",
      turns: 3,
      input: 1000,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      cost: 0,
    },
    {
      key: "openai/g",
      turns: 1,
      input: 5000,
      output: 500,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      cost: 0,
    },
  ],
  byDay: [],
  records: 4,
};

const preflight = (over: Partial<MigrationPreflight> = {}): MigrationPreflight => ({
  source: "/a",
  target: "/b",
  sourceVersion: 1,
  targetVersion: 1,
  canMigrate: true,
  sessions: { total: 3, conflicts: [] },
  warnings: [],
  blockers: [],
  ...over,
});

describe("token 格式化", () => {
  it("三档：原值 / k / M", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(2_500_000)).toBe("2.50M");
    expect(formatTokenCount(Number.NaN)).toBe("0");
  });
});

describe("模型排行", () => {
  it("按 token 数倒序取前 N", () => {
    const rows = topModelRows(summary, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("openai/g");
    expect(rows[0]?.tokens).toBe("5.5k");
  });

  it("单桶描述含次数与 token", () => {
    expect(describeBucket(summary.byModel[0]!)).toBe("3 次 · 1.2k token");
  });
});

describe("迁移预检描述", () => {
  it("不能迁时直接给原因", () => {
    expect(
      describePreflight(preflight({ canMigrate: false, blockers: ["源不是数据层"] })),
    ).toContain("不能迁移：源不是数据层");
  });

  it("能迁时报总量与冲突数", () => {
    const text = describePreflight(
      preflight({
        sessions: { total: 3, conflicts: [{ sessionId: "a", file: "/x", reason: "exists" }] },
      }),
    );
    expect(text).toContain("共 3 条会话");
    expect(text).toContain("1 条与目标同名");
  });

  it("版本展示兼容 null", () => {
    expect(describeVersions(preflight({ sourceVersion: null }))).toBe(
      "源版本 无法识别 → 目标版本 1",
    );
  });
});
