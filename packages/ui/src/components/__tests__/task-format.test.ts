import type { TaskSummary } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  describeNextRun,
  describeRuns,
  describeSchedule,
  formatRelative,
  statusLabel,
  statusTone,
} from "../task-format.ts";

const NOW = new Date("2026-03-01T10:00:00.000Z");

function task(over: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "t-1",
    kind: "cron",
    status: "active",
    prompt: "巡检",
    cwd: "/work",
    runs: [],
    skipped: [],
    ...over,
  };
}

describe("describeSchedule", () => {
  it("定时 / 一次性 / 闲时三种形态各有说法", () => {
    expect(describeSchedule(task({ cron: "0 9 * * 1-5" }))).toContain("cron 0 9 * * 1-5");
    expect(describeSchedule(task({ delayMinutes: 30 }))).toContain("30 分钟后");
    expect(describeSchedule(task({ kind: "idle", everyMinutes: 15 }))).toContain("每 15 分钟");
    expect(describeSchedule(task({ kind: "idle", everyMinutes: 15 }))).toContain("宿主空闲");
  });
});

describe("formatRelative", () => {
  it("未来与过去分别用「后」「前」", () => {
    expect(formatRelative("2026-03-01T10:05:00.000Z", NOW)).toBe("5 分钟后");
    expect(formatRelative("2026-03-01T09:30:00.000Z", NOW)).toBe("30 分钟前");
    expect(formatRelative("2026-03-01T12:00:00.000Z", NOW)).toBe("2 小时后");
    expect(formatRelative("2026-02-27T10:00:00.000Z", NOW)).toBe("2 天前");
  });

  it("缺失或非法时间返回 null", () => {
    expect(formatRelative(undefined, NOW)).toBeNull();
    expect(formatRelative("不是时间", NOW)).toBeNull();
  });
});

describe("describeNextRun", () => {
  it("暂停/完成的文案优先于时间", () => {
    expect(
      describeNextRun(task({ status: "paused", nextRunAt: "2026-03-01T11:00:00.000Z" }), NOW),
    ).toBe("已暂停");
    expect(describeNextRun(task({ status: "completed" }), NOW)).toBe("已完成");
  });

  it("运行时显示下次触发", () => {
    expect(describeNextRun(task({ nextRunAt: "2026-03-01T10:10:00.000Z" }), NOW)).toBe(
      "下次 10 分钟后",
    );
    expect(describeNextRun(task({}), NOW)).toBe("未排期");
  });
});

describe("statusLabel", () => {
  it("状态标签与色调节奏一致", () => {
    expect(statusLabel("active")).toBe("运行中");
    expect(statusTone("active")).toBe("accent");
    expect(statusTone("paused")).toBe("warn");
    expect(statusTone("completed")).toBe("muted");
  });
});

describe("describeRuns", () => {
  it("没跑过与跑过的区分", () => {
    expect(describeRuns(task())).toBe("还没跑过");
    expect(
      describeRuns(
        task({
          runs: [{ at: "2026-03-01T09:00:00.000Z", sessionId: "s", status: "completed" }],
        }),
      ),
    ).toBe("已跑 1 次 · 上次成功");
  });

  it("失败时带上原因；跳过单独计数", () => {
    const text = describeRuns(
      task({
        runs: [{ at: "2026-03-01T09:00:00.000Z", sessionId: "s", status: "failed", note: "超时" }],
        skipped: [{ at: "2026-03-01T08:00:00.000Z", reason: "宿主忙碌" }],
      }),
    );
    expect(text).toContain("已跑 1 次");
    expect(text).toContain("跳过 1 次");
    expect(text).toContain("上次失败：超时");
  });
});
