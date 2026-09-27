import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { servicePaths } from "../../paths.ts";
import { removeFile, writeFileAtomic } from "../../storage/index.ts";
import { type AutomationTask, MAX_TASK_HISTORY } from "./types.ts";

/**
 * 任务的持久化（F-4.1~4.3）：一个任务一个 JSON 文件。
 *
 * 与数据层其它部分一致：非追加写走"临时文件 + rename"（`writeFileAtomic`），
 * 因此读到的永远是完整的任务对象，不会读到写了一半的 JSON。
 */

export function tasksDirFor(dataDir: string): string {
  return servicePaths(dataDir).tasks;
}

export function isValidTaskId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(id);
}

function taskFile(dataDir: string, id: string): string {
  return join(tasksDirFor(dataDir), `${id}.json`);
}

export async function listTasks(dataDir: string): Promise<AutomationTask[]> {
  let names: string[];
  try {
    names = await readdir(tasksDirFor(dataDir));
  } catch {
    return [];
  }
  const tasks: AutomationTask[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const task = await readTask(dataDir, name.slice(0, -".json".length));
    if (task !== null) tasks.push(task);
  }
  return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readTask(dataDir: string, id: string): Promise<AutomationTask | null> {
  if (!isValidTaskId(id)) return null;
  try {
    const raw = await readFile(taskFile(dataDir, id), "utf8");
    return normalizeTask(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeTask(dataDir: string, task: AutomationTask): Promise<void> {
  await mkdir(tasksDirFor(dataDir), { recursive: true, mode: 0o700 });
  const trimmed: AutomationTask = {
    ...task,
    runs: task.runs.slice(-MAX_TASK_HISTORY),
    skipped: task.skipped.slice(-MAX_TASK_HISTORY),
  };
  await writeFileAtomic(taskFile(dataDir, task.id), JSON.stringify(trimmed, null, 2), {
    mode: 0o600,
  });
}

export async function deleteTask(dataDir: string, id: string): Promise<boolean> {
  if (!isValidTaskId(id)) return false;
  try {
    await removeFile(taskFile(dataDir, id));
    return true;
  } catch {
    return false;
  }
}

/** 宽松归一：文件是用户可手改的，字段缺失时补默认值而不是崩掉调度器。 */
function normalizeTask(raw: unknown): AutomationTask | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !isValidTaskId(value.id)) return null;
  if (typeof value.prompt !== "string" || value.prompt === "") return null;
  if (typeof value.cwd !== "string" || value.cwd === "") return null;
  const kind = value.kind === "idle" ? "idle" : "cron";
  const status =
    value.status === "paused" || value.status === "completed" || value.status === "cancelled"
      ? value.status
      : "active";
  const now = new Date(0).toISOString();
  return {
    id: value.id,
    kind,
    prompt: value.prompt,
    cwd: value.cwd,
    status,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    runs: Array.isArray(value.runs) ? (value.runs as AutomationTask["runs"]) : [],
    skipped: Array.isArray(value.skipped) ? (value.skipped as AutomationTask["skipped"]) : [],
    ...(typeof value.cron === "string" ? { cron: value.cron } : {}),
    ...(typeof value.delayMinutes === "number" ? { delayMinutes: value.delayMinutes } : {}),
    ...(typeof value.everyMinutes === "number" ? { everyMinutes: value.everyMinutes } : {}),
    ...(typeof value.lastRunAt === "string" ? { lastRunAt: value.lastRunAt } : {}),
    ...(typeof value.nextRunAt === "string" ? { nextRunAt: value.nextRunAt } : {}),
    ...(typeof value.autonomy === "string"
      ? { autonomy: value.autonomy as AutomationTask["autonomy"] }
      : {}),
  };
}
