import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DATA_FORMAT_VERSION, servicePaths } from "../../paths.ts";
import { listSessionFiles } from "./usage.ts";

/**
 * 数据迁移与导入向导（F-5.8）：**先预检、再动手**。
 *
 * 迁移最怕的是"跑到一半发现版本不兼容/大量冲突"。所以这里把它拆成两步：
 * - `preflightMigration`：**只读**地报告"会搬什么、有什么冲突、有什么风险"，不写任何东西；
 * - `applyMigration`：按预检结论执行，冲突默认**跳过**（不覆盖已有会话——那可能是本机正在用的）。
 */

export type MigrationConflict = { sessionId: string; file: string; reason: "exists" };

export type MigrationPreflight = {
  source: string;
  target: string;
  /** 版本可读且源目录存在、且不是同一个目录。 */
  canMigrate: boolean;
  sessions: { total: number; conflicts: MigrationConflict[] };
  /** 预检不阻塞但用户该知道的事。 */
  warnings: string[];
  /** 阻塞性原因（有它就 canMigrate=false）。 */
  blockers: string[];
};

export type MigrationResult = {
  copied: string[];
  skipped: MigrationConflict[];
};

export async function preflightMigration(input: {
  from: string;
  to: string;
}): Promise<MigrationPreflight> {
  const source = resolve(input.from);
  const target = resolve(input.to);
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (source === target) blockers.push("源目录与目标目录相同，无需迁移。");

  if (!(await hasVersionDir(source))) {
    blockers.push(`源目录不是本格式的数据根（缺少 ${DATA_FORMAT_VERSION} 目录）。`);
  }

  const sourceFiles = await listSessionFiles(servicePaths(source).sessions);
  const targetFiles = await listSessionFiles(servicePaths(target).sessions);
  const targetIds = new Set(targetFiles.map((file) => sessionIdFromPath(file)).filter(Boolean));

  const conflicts: MigrationConflict[] = [];
  for (const file of sourceFiles) {
    const sessionId = sessionIdFromPath(file);
    if (sessionId !== null && targetIds.has(sessionId)) {
      conflicts.push({ sessionId, file, reason: "exists" });
    }
  }
  if (conflicts.length > 0) {
    warnings.push(
      `有 ${conflicts.length} 条会话在目标里已存在，默认跳过（不覆盖本机正在用的会话）。`,
    );
  }

  return {
    source,
    target,
    canMigrate: blockers.length === 0,
    sessions: { total: sourceFiles.length, conflicts },
    warnings,
    blockers,
  };
}

export async function applyMigration(input: {
  from: string;
  to: string;
  /** 冲突处置；默认跳过（不覆盖）。 */
  onConflict?: "skip" | "overwrite";
}): Promise<MigrationResult> {
  const preflight = await preflightMigration(input);
  if (!preflight.canMigrate) {
    throw new Error(`不能迁移：${preflight.blockers.join("；")}`);
  }
  const onConflict = input.onConflict ?? "skip";
  const sourceFiles = await listSessionFiles(servicePaths(preflight.source).sessions);
  const conflictFiles = new Set(preflight.sessions.conflicts.map((conflict) => conflict.file));

  const copied: string[] = [];
  const skipped: MigrationConflict[] = [];
  for (const file of sourceFiles) {
    if (conflictFiles.has(file) && onConflict === "skip") {
      skipped.push({
        sessionId: sessionIdFromPath(file) ?? file,
        file,
        reason: "exists",
      });
      continue;
    }
    // 目标桶名 = 源里的桶名（桶名由工作区路径派生，两边必须一致才对得上）。
    const bucket =
      file.slice(servicePaths(preflight.source).sessions.length + 1).split("/")[0] ?? "";
    const destinationDir = join(servicePaths(preflight.target).sessions, bucket);
    await mkdir(destinationDir, { recursive: true, mode: 0o700 });
    await cp(file, join(destinationDir, file.split("/").pop() ?? "session.jsonl"), {
      force: onConflict === "overwrite",
      errorOnExist: onConflict === "skip",
    });
    copied.push(file);
  }
  return { copied, skipped };
}

/** 会话文件名形如 `<时间戳>_<会话id>.jsonl`。 */
export function sessionIdFromPath(file: string): string | null {
  const name = file.split("/").pop() ?? "";
  if (!name.endsWith(".jsonl")) return null;
  const stem = name.slice(0, -".jsonl".length);
  const index = stem.indexOf("_");
  return index === -1 ? stem : stem.slice(index + 1);
}

/** 判据是版本目录在不在：新布局用目录名承载数据格式版本，不再有 version 文件。 */
async function hasVersionDir(dataDir: string): Promise<boolean> {
  try {
    return (await stat(servicePaths(dataDir).dataDir)).isDirectory();
  } catch {
    return false;
  }
}

/** 目录里有多少会话（预检摘要用）。 */
export async function countSessions(dataDir: string): Promise<number> {
  try {
    return (await listSessionFiles(servicePaths(dataDir).sessions)).length;
  } catch {
    return 0;
  }
}
