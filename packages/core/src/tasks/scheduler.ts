import { randomBytes } from "node:crypto";
import { nextCronTime, parseCron } from "./cron.ts";
import { deleteTask, listTasks, writeTask } from "./store.ts";
import {
  type AutomationTask,
  DEFAULT_IDLE_INTERVAL_MINUTES,
  type TaskCreateInput,
  type TaskRun,
} from "./types.ts";

/**
 * 任务调度器（F-4.1 定时 / F-4.2 闲时 / F-4.3 绑定 / F-4.4 保持唤醒）。
 *
 * 设计取向：**调度器自己无状态**——每个 tick 从磁盘读任务、比较 `nextRunAt` 与当前时间。
 * 因此多实例看到的是同一批任务文件，重启也不丢；代价是 tick 里有 IO（任务量小，可接受）。
 *
 * - 定时：`cron` 表达式或一次性 `delayMinutes`，到点就跑；
 * - 闲时：`everyMinutes` 到期且**宿主不忙**才跑，忙则记一条跳过并把下个窗口往后推（F-4.2）；
 * - 绑定：任务带 `sessionId` 时投递到该会话（F-4.3）；为空则每次新建；
 * - 保持唤醒：`keepAwake` 有活跃任务即为真，宿主（桌面壳）据此阻止休眠（F-4.4）。
 */

export type TaskRunOutcome = {
  sessionId: string;
  status: "completed" | "failed";
  note?: string;
};

export type TaskRunner = (task: AutomationTask) => Promise<TaskRunOutcome>;

export type TaskSchedulerEvent = {
  type: "task.run" | "task.skipped" | "task.failed";
  taskId: string;
  detail?: string;
};

export type TaskSchedulerOptions = {
  dataDir: string;
  runner: TaskRunner;
  /** 宿主是否忙碌（闲时任务据此让路）。 */
  isBusy?: () => boolean;
  now?: () => Date;
  tickMs?: number;
  onEvent?: (event: TaskSchedulerEvent) => void;
};

export class TaskScheduler {
  #dataDir: string;
  #runner: TaskRunner;
  #isBusy: () => boolean;
  #now: () => Date;
  #tickMs: number;
  #onEvent?: (event: TaskSchedulerEvent) => void;
  #tasks = new Map<string, AutomationTask>();
  #timer: NodeJS.Timeout | undefined;
  #ticking = false;

  constructor(options: TaskSchedulerOptions) {
    this.#dataDir = options.dataDir;
    this.#runner = options.runner;
    this.#isBusy = options.isBusy ?? (() => false);
    this.#now = options.now ?? (() => new Date());
    this.#tickMs = options.tickMs ?? 30_000;
    this.#onEvent = options.onEvent;
  }

  async load(): Promise<void> {
    const tasks = await listTasks(this.#dataDir);
    this.#tasks = new Map(tasks.map((task) => [task.id, task]));
  }

  async start(): Promise<void> {
    await this.load();
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#tickMs);
    // 不让定时器阻止进程退出
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  list(): AutomationTask[] {
    return [...this.#tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** F-4.4：有活跃任务就希望宿主别睡。 */
  get keepAwake(): boolean {
    return [...this.#tasks.values()].some((task) => task.status === "active");
  }

  pendingCount(): number {
    return [...this.#tasks.values()].filter((task) => task.status === "active").length;
  }

  async create(input: TaskCreateInput): Promise<AutomationTask> {
    const now = this.#now();
    const cwd = input.cwd ?? process.cwd();
    if (input.prompt.trim() === "") throw new Error("任务需要 prompt。");

    let nextRunAt: Date | null;
    if (input.kind === "idle") {
      const every = input.everyMinutes ?? DEFAULT_IDLE_INTERVAL_MINUTES;
      if (every <= 0) throw new Error("everyMinutes 必须是正数。");
      nextRunAt = new Date(now.getTime() + every * 60_000);
    } else if (typeof input.delayMinutes === "number") {
      if (input.delayMinutes <= 0) throw new Error("delayMinutes 必须是正数。");
      nextRunAt = new Date(now.getTime() + input.delayMinutes * 60_000);
    } else if (typeof input.cron === "string") {
      const parsed = parseCron(input.cron);
      if (typeof parsed === "string") throw new Error(parsed);
      nextRunAt = nextCronTime(input.cron, now);
      if (nextRunAt === null) throw new Error(`cron 表达式在可见范围内没有匹配时刻：${input.cron}`);
    } else {
      throw new Error("定时任务需要 cron 或 delayMinutes 之一。");
    }

    const iso = now.toISOString();
    const task: AutomationTask = {
      id: newTaskId(),
      kind: input.kind,
      prompt: input.prompt.trim(),
      cwd,
      status: "active",
      sessionId: input.sessionId ?? null,
      createdAt: iso,
      updatedAt: iso,
      nextRunAt: nextRunAt.toISOString(),
      runs: [],
      skipped: [],
      ...(input.cron === undefined ? {} : { cron: input.cron }),
      ...(input.delayMinutes === undefined ? {} : { delayMinutes: input.delayMinutes }),
      ...(input.everyMinutes === undefined ? {} : { everyMinutes: input.everyMinutes }),
      ...(input.autonomy === undefined ? {} : { autonomy: input.autonomy }),
    };
    await writeTask(this.#dataDir, task);
    this.#tasks.set(task.id, task);
    return task;
  }

  async cancel(id: string): Promise<boolean> {
    const removed = await deleteTask(this.#dataDir, id);
    this.#tasks.delete(id);
    return removed;
  }

  async pause(id: string): Promise<boolean> {
    return this.#setStatus(id, "paused");
  }

  async resume(id: string): Promise<boolean> {
    const task = this.#tasks.get(id);
    if (task === undefined) return false;
    return this.#setStatus(id, "active", this.#computeNextRun(task, this.#now()) ?? undefined);
  }

  async #setStatus(
    id: string,
    status: AutomationTask["status"],
    nextRunAt?: Date,
  ): Promise<boolean> {
    const task = this.#tasks.get(id);
    if (task === undefined) return false;
    const next: AutomationTask = {
      ...task,
      status,
      updatedAt: this.#now().toISOString(),
      ...(nextRunAt === undefined ? {} : { nextRunAt: nextRunAt.toISOString() }),
    };
    await writeTask(this.#dataDir, next);
    this.#tasks.set(id, next);
    return true;
  }

  /** 立即触发一次（不改变计划，用于验证与手动运行）。 */
  async runNow(id: string): Promise<TaskRun | null> {
    const task = this.#tasks.get(id);
    if (task === undefined) return null;
    return this.#execute(task);
  }

  /** 一个调度周期：读盘、挑出到期的、按顺序跑。幂等且防重入。 */
  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      await this.load();
      const now = this.#now();
      for (const task of this.list()) {
        if (task.status !== "active" || task.nextRunAt === undefined) continue;
        if (new Date(task.nextRunAt).getTime() > now.getTime()) continue;

        // 闲时任务：宿主忙则让路（记跳过，下个窗口再试）。
        if (task.kind === "idle" && this.#isBusy()) {
          const every = task.everyMinutes ?? DEFAULT_IDLE_INTERVAL_MINUTES;
          await this.#recordSkip(task, "宿主忙碌", new Date(now.getTime() + every * 60_000));
          continue;
        }
        await this.#execute(task);
      }
    } finally {
      this.#ticking = false;
    }
  }

  async #execute(task: AutomationTask): Promise<TaskRun> {
    const now = this.#now();
    let run: TaskRun;
    try {
      const outcome = await this.#runner(task);
      run = {
        at: now.toISOString(),
        sessionId: outcome.sessionId,
        status: outcome.status,
        ...(outcome.note === undefined ? {} : { note: outcome.note }),
      };
      this.#onEvent?.({
        type: outcome.status === "completed" ? "task.run" : "task.failed",
        taskId: task.id,
        ...(outcome.note === undefined ? {} : { detail: outcome.note }),
      });
    } catch (error) {
      run = {
        at: now.toISOString(),
        sessionId: task.sessionId ?? "",
        status: "failed",
        note: error instanceof Error ? error.message : String(error),
      };
      this.#onEvent?.({ type: "task.failed", taskId: task.id, detail: run.note });
    }

    // 一次性的（delayMinutes 且无 cron）跑完即完成；周期任务排下一次。
    const oneShot = task.kind === "cron" && task.cron === undefined;
    const nextRunAt = oneShot ? undefined : (this.#computeNextRun(task, now) ?? undefined);
    const next: AutomationTask = {
      ...task,
      lastRunAt: run.at,
      updatedAt: now.toISOString(),
      runs: [...task.runs, run],
      status: oneShot ? "completed" : task.status,
      ...(nextRunAt === undefined ? {} : { nextRunAt: nextRunAt.toISOString() }),
    };
    await writeTask(this.#dataDir, next);
    this.#tasks.set(task.id, next);
    return run;
  }

  async #recordSkip(task: AutomationTask, reason: string, nextRunAt: Date): Promise<void> {
    const now = this.#now();
    const next: AutomationTask = {
      ...task,
      updatedAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      skipped: [...task.skipped, { at: now.toISOString(), reason }],
    };
    await writeTask(this.#dataDir, next);
    this.#tasks.set(task.id, next);
    this.#onEvent?.({ type: "task.skipped", taskId: task.id, detail: reason });
  }

  #computeNextRun(task: AutomationTask, from: Date): Date | null {
    if (task.kind === "idle") {
      const every = task.everyMinutes ?? DEFAULT_IDLE_INTERVAL_MINUTES;
      return new Date(from.getTime() + every * 60_000);
    }
    if (task.cron !== undefined) return nextCronTime(task.cron, from);
    return null;
  }
}

function newTaskId(): string {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
