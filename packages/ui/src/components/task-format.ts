import type { TaskStatus, TaskSummary } from "@ucode/sdk";

/**
 * 自动化面板的**纯展示逻辑**（F-4.5）。
 *
 * 单独抽出来是为了能单测：面板组件本身依赖 React 与 store，而这些"怎么描述一条任务"
 * 的规则（调度表达式、下次触发、运行历史）与渲染无关，且最容易出错（时间/边界）。
 */

const MINUTE = 60_000;

export function describeSchedule(task: TaskSummary): string {
  if (task.kind === "idle") {
    return `闲时任务 · 每 ${task.everyMinutes ?? 30} 分钟（宿主空闲才跑）`;
  }
  if (task.cron !== undefined) return `定时任务 · cron ${task.cron}`;
  if (task.delayMinutes !== undefined) return `一次性 · ${task.delayMinutes} 分钟后`;
  return "定时任务";
}

/** 相对时间：未来用"X 分钟后"，过去用"X 分钟前"。 */
export function formatRelative(iso: string | undefined, now: Date): string | null {
  if (iso === undefined) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const diff = at.getTime() - now.getTime();
  const future = diff >= 0;
  const minutes = Math.round(Math.abs(diff) / MINUTE);
  if (minutes < 1) return future ? "即将" : "刚刚";
  if (minutes < 60) return future ? `${minutes} 分钟后` : `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `${hours} 小时后` : `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return future ? `${days} 天后` : `${days} 天前`;
}

export function describeNextRun(task: TaskSummary, now: Date): string {
  if (task.status === "paused") return "已暂停";
  if (task.status === "completed") return "已完成";
  if (task.status === "cancelled") return "已取消";
  const relative = formatRelative(task.nextRunAt, now);
  return relative === null ? "未排期" : `下次 ${relative}`;
}

export function describeRuns(task: TaskSummary): string {
  const runs = task.runs ?? [];
  const skipped = task.skipped ?? [];
  const parts: string[] = [];
  if (runs.length > 0) parts.push(`已跑 ${runs.length} 次`);
  if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 次`);
  if (parts.length === 0) return "还没跑过";
  const last = runs.at(-1);
  if (last !== undefined) {
    if (last.status === "failed") parts.push(`上次失败：${last.note ?? "未知原因"}`);
    else parts.push("上次成功");
  }
  return parts.join(" · ");
}

export function statusTone(status: TaskStatus): "muted" | "accent" | "warn" {
  if (status === "active") return "accent";
  if (status === "paused") return "warn";
  return "muted";
}

export function statusLabel(status: TaskStatus): string {
  if (status === "active") return "运行中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  return "已取消";
}
