import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextCronTime, parseCron } from "../cron.ts";
import { TaskScheduler } from "../scheduler.ts";
import { listTasks, readTask } from "../store.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tasks-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const local = (iso: string): Date => new Date(iso);

describe("cron 解析", () => {
  describe("parseCron", () => {
    it("拒绝段数不对或越界的表达式", () => {
      expect(typeof parseCron("* * *")).toBe("string");
      expect(typeof parseCron("60 * * * *")).toBe("string");
      expect(typeof parseCron("* * * * 8")).toBe("string");
      expect(typeof parseCron("* * * * */0")).toBe("string");
    });

    it("展开列表、区间与步长", () => {
      const fields = parseCron("*/15 9-11 1,15 * 1-5");
      if (typeof fields === "string") throw new Error(fields);
      expect(fields.minutes).toEqual([0, 15, 30, 45]);
      expect(fields.hours).toEqual([9, 10, 11]);
      expect(fields.doms).toEqual([1, 15]);
      expect(fields.dows).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("nextCronTime", () => {
    it("计算分钟级的下一次触发", () => {
      expect(nextCronTime("*/15 * * * *", local("2026-03-01T10:07:00"))?.toISOString()).toBe(
        local("2026-03-01T10:15:00").toISOString(),
      );
    });

    it("严格晚于起点（起点正好命中时取下一次）", () => {
      expect(nextCronTime("0 12 * * *", local("2026-03-01T12:00:00"))?.toISOString()).toBe(
        local("2026-03-02T12:00:00").toISOString(),
      );
    });

    it("支持月份名与星期名", () => {
      // 2026-03-02 是周一
      expect(nextCronTime("30 8 * mar mon", local("2026-03-01T00:00:00"))?.toISOString()).toBe(
        local("2026-03-02T08:30:00").toISOString(),
      );
    });

    it("日与周都受限时取或语义", () => {
      // 每月 1 号或每周一 9:00；从 3/1(周日) 起 → 3/1 9:00（日匹配）
      expect(nextCronTime("0 9 1 * 1", local("2026-02-28T00:00:00"))?.toISOString()).toBe(
        local("2026-03-01T09:00:00").toISOString(),
      );
    });
  });
});

describe("TaskScheduler", () => {
  it("定时任务到点触发并按计划排下一次", async () => {
    let clock = local("2026-03-01T10:00:00");
    const fired: string[] = [];
    const scheduler = new TaskScheduler({
      dataDir: root,
      now: () => clock,
      tickMs: 9_999_999,
      runner: async (task) => {
        fired.push(task.id);
        return { sessionId: "s1", status: "completed" };
      },
    });
    await scheduler.load();
    const task = await scheduler.create({ kind: "cron", cron: "*/5 * * * *", prompt: "巡检" });
    expect(task.nextRunAt).toBe(local("2026-03-01T10:05:00").toISOString());

    await scheduler.tick(); // 未到点
    expect(fired).toEqual([]);

    clock = local("2026-03-01T10:05:01");
    await scheduler.tick();
    expect(fired).toEqual([task.id]);
    expect(scheduler.list()[0]?.nextRunAt).toBe(local("2026-03-01T10:10:00").toISOString());
  });

  it("一次性任务跑完即完成，不再排期", async () => {
    let clock = local("2026-03-01T10:00:00");
    const scheduler = new TaskScheduler({
      dataDir: root,
      now: () => clock,
      tickMs: 9_999_999,
      runner: async () => ({ sessionId: "s1", status: "completed" }),
    });
    await scheduler.load();
    const task = await scheduler.create({ kind: "cron", delayMinutes: 1, prompt: "一次" });
    clock = local("2026-03-01T10:02:00");
    await scheduler.tick();
    const after = await readTask(root, task.id);
    expect(after?.status).toBe("completed");
    expect(after?.runs).toHaveLength(1);
  });

  it("闲时任务：宿主忙则跳过（记跳过、窗口后移），不忙才跑", async () => {
    let clock = local("2026-03-01T10:00:00");
    let busy = true;
    const fired: string[] = [];
    const scheduler = new TaskScheduler({
      dataDir: root,
      now: () => clock,
      tickMs: 9_999_999,
      isBusy: () => busy,
      runner: async (task) => {
        fired.push(task.id);
        return { sessionId: "s1", status: "completed" };
      },
    });
    await scheduler.load();
    const task = await scheduler.create({ kind: "idle", everyMinutes: 10, prompt: "闲时整理" });

    clock = local("2026-03-01T10:11:00");
    await scheduler.tick();
    expect(fired).toEqual([]); // 忙 → 跳过
    let current = await readTask(root, task.id);
    expect(current?.skipped).toHaveLength(1);
    expect(current?.runs).toHaveLength(0);

    busy = false;
    clock = local("2026-03-01T10:21:00");
    await scheduler.tick();
    expect(fired).toEqual([task.id]);
    current = await readTask(root, task.id);
    expect(current?.runs).toHaveLength(1);
  });

  it("保持唤醒状态随活跃任务变化", async () => {
    const scheduler = new TaskScheduler({
      dataDir: root,
      tickMs: 9_999_999,
      runner: async () => ({ sessionId: "s1", status: "completed" }),
    });
    await scheduler.load();
    expect(scheduler.keepAwake).toBe(false);
    const task = await scheduler.create({ kind: "cron", delayMinutes: 30, prompt: "x" });
    expect(scheduler.keepAwake).toBe(true);
    await scheduler.cancel(task.id);
    expect(scheduler.keepAwake).toBe(false);
  });

  it("非法 cron 在创建时被拒绝", async () => {
    const scheduler = new TaskScheduler({
      dataDir: root,
      tickMs: 9_999_999,
      runner: async () => ({ sessionId: "s1", status: "completed" }),
    });
    await scheduler.load();
    await expect(scheduler.create({ kind: "cron", cron: "bad", prompt: "x" })).rejects.toThrow();
  });
});

describe("listTasks", () => {
  it("写入后可从磁盘读回（跨实例可见）", async () => {
    const scheduler = new TaskScheduler({
      dataDir: root,
      tickMs: 9_999_999,
      runner: async () => ({ sessionId: "s1", status: "completed" }),
    });
    await scheduler.load();
    const task = await scheduler.create({
      kind: "cron",
      delayMinutes: 5,
      prompt: "写报告",
      cwd: "/tmp/x",
      sessionId: "sess-1",
    });
    // 新实例（模拟另一个服务层进程/重启）也能看到
    const reloaded = await listTasks(root);
    expect(reloaded.map((item) => item.id)).toEqual([task.id]);
    expect(reloaded[0]?.sessionId).toBe("sess-1");
    expect(reloaded[0]?.cwd).toBe("/tmp/x");
  });
});
