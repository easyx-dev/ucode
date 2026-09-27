import { cp, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { storePaths } from "@ucode/store";
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
  sourceVersion: number | null;
  targetVersion: number | null;
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

  const sourceVersion = await readVersionFile(source);
  const targetVersion = await readVersionFile(target);
  if (sourceVersion === null) {
    blockers.push("源目录不是可识别的数据层（缺少或无法解析 version 文件）。");
  }
  if (targetVersion !== null && sourceVersion !== null && targetVersion !== sourceVersion) {
    // 数据层版本前向拒绝：不替用户做"升级"的决定。
    warnings.push(
      `数据层版本不一致（源 ${sourceVersion}，目标 ${targetVersion}）：导入后如有异常，请先确认两边的数据层协议版本。`,
    );
  }

  const sourceFiles = await listSessionFiles(storePaths(source).sessions);
  const targetFiles = await listSessionFiles(storePaths(target).sessions);
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
    sourceVersion,
    targetVersion,
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
  const sourceFiles = await listSessionFiles(storePaths(preflight.source).sessions);
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
    const bucket = file.slice(storePaths(preflight.source).sessions.length + 1).split("/")[0] ?? "";
    const destinationDir = join(storePaths(preflight.target).sessions, bucket);
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

async function readVersionFile(dataDir: string): Promise<number | null> {
  try {
    const raw = (await readFile(join(dataDir, "version"), "utf8")).trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/** 目录里有多少会话（预检摘要用）。 */
export async function countSessions(dataDir: string): Promise<number> {
  try {
    return (await listSessionFiles(storePaths(dataDir).sessions)).length;
  } catch {
    return 0;
  }
}
