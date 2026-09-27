import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IndexedSession } from "./contracts.ts";
import { entryRole, entryText, parseSessionFile, type SessionEntry } from "./entries.ts";

/**
 * 会话索引（SQLite）。
 *
 * 正文在 `sessions/*.jsonl`（追加式，唯一权威），索引在 `sessions` 表里加速查询。
 * 索引**始终可丢、可重建**：真相同永远是扫描会话目录本身，所以这里所有写入都是
 * "尽力刷新"，坏了重扫即可，不是数据事故。
 *
 * 单写者（一个数据根一个服务）让"跨实例陈旧"大多消失，但仍留一条对账：
 * 目录的数量与 mtime 变了就重扫——用户可能用真正的 pi CLI 往同一个目录里写会话。
 */

/** 归档标记的自定义记录类型（追加式表达状态变化）。 */
export const ARCHIVE_MARKER = "session.archived";

/** 单个会话文件的读取上限：超过就跳过（不让一个巨型文件拖垮列表）。 */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

const META_MARKER_KEY = "sessions.directory_marker";

type SessionRow = {
  id: string;
  cwd: string;
  name: string | null;
  created_at: number;
  updated_at: number;
  entry_count: number;
  first_message: string | null;
  archived_at: number | null;
};

function toIndexed(row: SessionRow): IndexedSession {
  return {
    id: row.id,
    cwd: row.cwd,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    entryCount: row.entry_count,
    firstMessage: row.first_message,
    archived: row.archived_at !== null,
  };
}

export function upsertSession(database: DatabaseSync, session: IndexedSession): void {
  database
    .prepare(
      `INSERT INTO sessions (id, cwd, name, created_at, updated_at, entry_count, first_message, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cwd = excluded.cwd,
         name = COALESCE(excluded.name, sessions.name),
         updated_at = excluded.updated_at,
         entry_count = excluded.entry_count,
         first_message = COALESCE(excluded.first_message, sessions.first_message),
         archived_at = excluded.archived_at`,
    )
    .run(
      session.id,
      session.cwd,
      session.name,
      Date.parse(session.createdAt),
      Date.parse(session.updatedAt),
      session.entryCount,
      session.firstMessage,
      session.archived ? Date.now() : null,
    );
}

export function readSession(database: DatabaseSync, id: string): IndexedSession | undefined {
  const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  return row === undefined ? undefined : toIndexed(row);
}

export function listSessions(
  database: DatabaseSync,
  options: { cwd?: string } = {},
): IndexedSession[] {
  const rows = (
    options.cwd === undefined
      ? database.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all()
      : database
          .prepare("SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC")
          .all(options.cwd)
  ) as SessionRow[];
  return rows.map(toIndexed);
}

/** 追加一条记录之后的记账：条目数与更新时间。 */
export function touchSession(database: DatabaseSync, id: string, entryCount: number): void {
  database
    .prepare("UPDATE sessions SET entry_count = ?, updated_at = ? WHERE id = ?")
    .run(entryCount, Date.now(), id);
}

export function setSessionName(database: DatabaseSync, id: string, name: string | null): void {
  database
    .prepare("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, Date.now(), id);
}

export function setSessionArchived(database: DatabaseSync, id: string, archived: boolean): void {
  database
    .prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(archived ? Date.now() : null, Date.now(), id);
}

/** 扫描会话目录（协议与 pi 一致：`sessions/--<escaped>--/<ts>_<id>.jsonl`）。 */
export async function scanSessionFiles(
  sessionsRoot: string,
  options: { cwd?: string } = {},
): Promise<IndexedSession[]> {
  const buckets = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions: IndexedSession[] = [];

  for (const bucket of buckets) {
    if (!bucket.isDirectory() || !bucket.name.startsWith("--")) continue;
    const bucketPath = join(sessionsRoot, bucket.name);
    for (const file of await readdir(bucketPath, { withFileTypes: true }).catch(() => [])) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const filePath = join(bucketPath, file.name);
      const info = await stat(filePath).catch(() => undefined);
      if (info === undefined || info.size > MAX_SCAN_BYTES) continue;

      const content = await readFile(filePath, "utf8").catch(() => undefined);
      if (content === undefined) continue;
      // 会话文件必须由 header 定义：没有 header 的文件（坏文件、别人的文件）不是会话。
      const parsed = parseSessionFile(content);
      if (parsed.header === null) continue;
      if (options.cwd !== undefined && parsed.header.cwd !== options.cwd) continue;

      const entries = parsed.entries.map((record) => record.entry);
      sessions.push({
        id: parsed.header.id,
        cwd: parsed.header.cwd,
        name: lastSessionName(entries),
        createdAt: parsed.header.timestamp,
        updatedAt: info.mtime.toISOString(),
        entryCount: entries.length,
        firstMessage: firstUserText(entries),
        archived: isArchived(entries),
      });
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

/** 全量重建索引（忽略现有行）。 */
export async function rebuildIndex(
  database: DatabaseSync,
  sessionsRoot: string,
): Promise<IndexedSession[]> {
  const sessions = await scanSessionFiles(sessionsRoot);
  database.exec("BEGIN");
  try {
    database.exec("DELETE FROM sessions");
    for (const session of sessions) upsertSession(database, session);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  await writeMarker(database, await directoryMarker(sessionsRoot));
  return sessions;
}

/**
 * 目录变了就重扫。
 *
 * 判据是"会话文件的数量 + 最新 mtime"这个轻量标记：只 readdir、不读文件内容，
 * 比每次列表全量扫描便宜，又不会漏掉"别的进程往这个目录里写了新会话"。
 */
export async function refreshIndexIfStale(
  database: DatabaseSync,
  sessionsRoot: string,
): Promise<void> {
  const marker = await directoryMarker(sessionsRoot);
  if (readMeta(database, META_MARKER_KEY) === marker) return;
  await rebuildIndex(database, sessionsRoot);
}

async function directoryMarker(sessionsRoot: string): Promise<string> {
  let count = 0;
  let latest = 0;
  for (const bucket of await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!bucket.isDirectory() || !bucket.name.startsWith("--")) continue;
    const bucketPath = join(sessionsRoot, bucket.name);
    for (const file of await readdir(bucketPath, { withFileTypes: true }).catch(() => [])) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const info = await stat(join(bucketPath, file.name)).catch(() => undefined);
      if (info === undefined) continue;
      count += 1;
      if (info.mtimeMs > latest) latest = info.mtimeMs;
    }
  }
  return `${count}:${latest}`;
}

async function writeMarker(database: DatabaseSync, marker: string): Promise<void> {
  writeMeta(database, META_MARKER_KEY, marker);
}

export function readMeta(database: DatabaseSync, key: string): string | undefined {
  const row = database.prepare("SELECT value FROM service_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function writeMeta(database: DatabaseSync, key: string, value: string): void {
  database
    .prepare(
      "INSERT INTO service_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/** 最后一条归档标记说了算（追加式表达状态变化）。 */
function isArchived(entries: SessionEntry[]): boolean {
  let archived = false;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== ARCHIVE_MARKER) continue;
    archived = (entry.data as { archived?: boolean } | undefined)?.archived === true;
  }
  return archived;
}

function firstUserText(entries: SessionEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entryRole(entry) !== "user") continue;
    const text = entryText(entry);
    if (text !== undefined && text.trim() !== "") return text.slice(0, 200);
  }
  return null;
}

function lastSessionName(entries: SessionEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "session_info") continue;
    const name = entry.name;
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}
