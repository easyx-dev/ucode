import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  entryRole,
  entryText,
  type IndexedSession,
  parseSessionFile,
  type SessionEntry,
  type StorePaths,
} from "@ucode/data-layer-spec";
import { removeFile, writeFileAtomic } from "./atomic.ts";
import { anyOwnerAlive } from "./owner.ts";

/** 归档标记的自定义记录类型（协议 D 的合法用法：追加式表达状态变化）。 */
export const ARCHIVE_MARKER = "session.archived";

/**
 * 派生数据（spec §3.2 的最后一行、§3.4 第 3 条）。
 *
 * **派生数据必须随时可丢**：真相永远是扫描数据层本身的结果，索引只是加速。
 * 因此这里的每个函数都可以在索引缺失/损坏时从磁盘重建，且损坏不是数据事故。
 */

export const INDEX_FILE_NAME = "sessions-index.json";

/** 单个会话文件的读取上限：超过就只读头部（不让一个巨型文件拖垮列表）。 */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export type SessionIndex = {
  generatedAt: string;
  sessions: IndexedSession[];
};

export async function readIndex(
  paths: StorePaths,
): Promise<{ index?: SessionIndex; valid: boolean }> {
  try {
    const raw = JSON.parse(
      await readFile(join(paths.cache, INDEX_FILE_NAME), "utf8"),
    ) as SessionIndex;
    const valid = typeof raw === "object" && raw !== null && Array.isArray(raw.sessions);
    return valid ? { index: raw, valid: true } : { valid: false };
  } catch {
    return { valid: false }; // 缺失或损坏都当"需要重建"，不是错误
  }
}

export async function writeIndex(
  paths: StorePaths,
  sessions: IndexedSession[],
  now: () => Date,
): Promise<SessionIndex> {
  const index: SessionIndex = { generatedAt: now().toISOString(), sessions };
  // 派生目录可能被用户或清理脚本删掉（"派生数据必须随时可丢"），因此每次都确保它存在。
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  await writeFileAtomic(join(paths.cache, INDEX_FILE_NAME), JSON.stringify(index, null, 2), {
    mode: 0o600,
  });
  return index;
}

/**
 * 索引只是加速：一旦数据变了就删掉它，让下次 listSessions 重新扫描。
 * 这比"维护一致性"可靠得多——派生数据损坏不是数据事故（spec §3.4 第 3 条）。
 */
export async function invalidateIndex(paths: StorePaths): Promise<void> {
  await removeFile(join(paths.cache, INDEX_FILE_NAME));
}

/**
 * 索引是否还新鲜：拿它的生成时间与 sessions 目录的 mtime 比。
 *
 * 为什么需要它：**索引是派生数据，而写它的是别的实例**（多实例共享一个数据层）。
 * 只靠"本实例写完就作废"在单实例下够用，跨实例就会一直读到旧索引。
 * 对账的代价是一次 readdir——比"猜它是否新鲜"便宜得多。
 */
export async function isIndexFresh(paths: StorePaths, index: SessionIndex): Promise<boolean> {
  const generatedAt = Date.parse(index.generatedAt);
  if (Number.isNaN(generatedAt)) return false;
  const roots = [paths.sessions];
  const buckets = await readdir(paths.sessions, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (bucket.isDirectory()) roots.push(join(paths.sessions, bucket.name));
  }
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const info = await stat(join(root, entry.name)).catch(() => undefined);
      if (info !== undefined && info.mtimeMs > generatedAt) return false;
    }
  }
  return true;
}

/** 扫描会话目录构建索引（协议 D 的唯一真相来源是磁盘本身）。 */
export async function scanSessions(
  paths: StorePaths,
  options: { cwd?: string; now: () => Date },
): Promise<IndexedSession[]> {
  const buckets = await readdir(paths.sessions, { withFileTypes: true }).catch(() => []);
  const sessions: IndexedSession[] = [];

  for (const bucket of buckets) {
    if (!bucket.isDirectory() || !bucket.name.startsWith("--") || !bucket.name.endsWith("--"))
      continue;
    const bucketPath = join(paths.sessions, bucket.name);
    const files = await readdir(bucketPath, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const filePath = join(bucketPath, file.name);
      const info = await stat(filePath).catch(() => undefined);
      if (info === undefined) continue;
      // 会话文件必须由 header 定义：没有 header 的文件（锁、索引、坏文件）不是会话。
      if (info.size > MAX_SCAN_BYTES) continue;

      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSessionFile(content);
      if (parsed.header === null) continue;
      if (options.cwd !== undefined && parsed.header.cwd !== options.cwd) continue;

      const entries = parsed.entries.map((record) => record.entry);
      sessions.push({
        id: parsed.header.id,
        cwd: parsed.header.cwd,
        file: filePath,
        name: lastName(entries),
        createdAt: parsed.header.timestamp,
        updatedAt: info.mtime.toISOString(),
        entryCount: entries.length,
        firstMessage: firstUserText(entries),
        owned: await anyOwnerAlive(paths, parsed.header.id),
        archived: isArchived(entries),
      });
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

type ScannedEntry = SessionEntry;

/** 最后一条归档标记说了算（追加式表达状态变化）。 */
function isArchived(entries: ScannedEntry[]): boolean {
  let archived = false;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== ARCHIVE_MARKER) continue;
    archived = (entry.data as { archived?: boolean } | undefined)?.archived === true;
  }
  return archived;
}

function firstUserText(entries: ScannedEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entryRole(entry) !== "user") continue;
    const text = entryText(entry);
    if (text !== undefined && text.trim() !== "") return text.slice(0, 200);
  }
  return null;
}

function lastName(entries: ScannedEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "session_info") continue;
    const name = entry.name;
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}
