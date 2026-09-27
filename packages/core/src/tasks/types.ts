import type { AutonomyLevel } from "@ucode/protocol";

/**
 * 自动化任务（F-4.1 定时 / F-4.2 闲时 / F-4.3 绑定会话）。
 *
 * 任务是**数据层的普通 JSON 文件**（`<数据层>/tasks/<id>.json`），因此跨实例可见、可手工检查、
 * 崩溃后仍在——调度器本身无状态，"什么时候该跑"由 `nextRunAt` 与当前时间决定。
 */

export type TaskKind = "cron" | "idle";
export type TaskStatus = "active" | "paused" | "completed" | "cancelled";

export type TaskRun = {
  at: string;
  sessionId: string;
  status: "completed" | "failed" | "skipped";
  note?: string;
};

export type TaskSkip = {
  at: string;
  reason: string;
};

export type AutomationTask = {
  id: string;
  kind: TaskKind;
  /** cron 表达式（kind=cron 且未给 delayMinutes 时必填）。 */
  cron?: string;
  /** 一次性：从现在起 N 分钟后跑一次（kind=cron 可用）。 */
  delayMinutes?: number;
  /** 闲时任务的最小间隔（分钟，kind=idle 用）。 */
  everyMinutes?: number;
  /** 触发时交给 agent 的提示词。 */
  prompt: string;
  cwd: string;
  /** 绑定的会话（F-4.3）：触发时投递到同一会话；为空则每次新建。 */
  sessionId: string | null;
  /** 触发时的自主级别（越权任务要显式声明）。 */
  autonomy?: AutonomyLevel;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  /** 下次计划触发时间（调度器据此排序）。 */
  nextRunAt?: string;
  runs: TaskRun[];
  skipped: TaskSkip[];
};

export type TaskCreateInput = {
  kind: TaskKind;
  prompt: string;
  cwd?: string;
  cron?: string;
  delayMinutes?: number;
  everyMinutes?: number;
  sessionId?: string | null;
  autonomy?: AutonomyLevel;
};

/** 运行历史与跳过记录各保留最近 N 条（文件不该无限增长）。 */
export const MAX_TASK_HISTORY = 20;
export const DEFAULT_IDLE_INTERVAL_MINUTES = 30;

export function taskLabel(task: AutomationTask): string {
  if (task.kind === "idle")
    return `闲时每 ${task.everyMinutes ?? DEFAULT_IDLE_INTERVAL_MINUTES} 分钟`;
  if (task.cron !== undefined) return `cron ${task.cron}`;
  return "一次性";
}
