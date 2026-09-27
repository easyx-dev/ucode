import { createHash, type Hash, randomBytes } from "node:crypto";
import { mkdir, open as openFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendLine, truncateToLastNewline } from "./atomic.ts";
import type {
  AppendInput,
  RewriteDetection,
  SessionRecord,
  SessionRepo,
  TailRepair,
} from "./contracts.ts";
import {
  CURRENT_SESSION_VERSION,
  parseSessionFile,
  type SessionEntry,
  type SessionHeader,
  serializeEntry,
} from "./entries.ts";
import { StorageError } from "./errors.ts";
import { assertSafeSessionId, resolveWithin, sessionBucketWithin } from "./guards.ts";
import { createSessionId, sessionFileName } from "./naming.ts";

/** 只关心会话目录在哪：其余路径字段与本模块无关。 */
type SessionRoot = { sessions: string };

/**
 * 会话读写（协议 D 的参考实现，spec §3.3 / §3.12）。
 *
 * 四条会话存储性质在这里落地：
 * 1. **追加式**——只 append，不重写（截断只用于处置崩溃尾部）；
 * 2. **带父指针的树**——append 未指定 parentId 时接到当前叶子之后；
 * 3. **单调游标**——序号 = 记录在文件中的行序号（header 为第 0 行）；
 * 4. **每会话独立**——游标、树、追加序列都以单个会话为作用域。
 */

type RepoState = {
  cursor: number;
  leafId: string | null;
  ids: Set<string>;
  /**
   * "已知内容"的字节长度与增量哈希。
   *
   * 判据是**前缀延伸**：文件当前内容必须以已知内容为前缀，否则就是整体替换。
   * 之所以不能只比 inode：格式迁移是**原地重写**（inode 不变，V-5 已推翻原假设）；
   * 之所以用字节长度：会话里有中文，按字符切会切错位置。
   */
  knownLength: number;
  knownHash: Hash;
};

function makeEntryId(ids: Set<string>): string {
  for (;;) {
    const id = randomBytes(4).toString("hex");
    if (!ids.has(id)) return id;
  }
}

function stateFromContent(content: string): RepoState {
  const parsed = parseSessionFile(content);
  return {
    cursor: parsed.entries.length,
    leafId: parsed.entries.at(-1)?.entry.id ?? null,
    ids: new Set(parsed.entries.map((record) => record.entry.id)),
    knownLength: Buffer.byteLength(content, "utf8"),
    knownHash: createHash("sha256").update(content, "utf8"),
  };
}

function applyContent(state: RepoState, content: string): void {
  const next = stateFromContent(content);
  state.cursor = next.cursor;
  state.leafId = next.leafId;
  state.ids = next.ids;
  state.knownLength = next.knownLength;
  state.knownHash = next.knownHash;
}

async function readContent(file: string): Promise<string> {
  return readFile(file, "utf8");
}

function buildRepo(params: {
  id: string;
  cwd: string;
  file: string;
  createdAt: Date;
  state: RepoState;
  now: () => Date;
  onAppend?: (record: SessionRecord) => Promise<void>;
}): SessionRepo {
  const { id, cwd, file, createdAt, now, onAppend } = params;
  const state = params.state;

  return {
    id,
    cwd,
    file,
    createdAt,

    async readHeader(): Promise<SessionHeader> {
      const parsed = parseSessionFile(await readContent(file));
      if (parsed.header === null) {
        throw new StorageError("session_broken", `会话文件缺少合法的 header：${file}`, { file });
      }
      return parsed.header;
    },

    async read(fromSeq = 0, limit?: number): Promise<SessionRecord[]> {
      const content = await readContent(file);
      const parsed = parseSessionFile(content);
      applyContent(state, content);
      const filtered = parsed.entries.filter((record) => record.seq > fromSeq);
      return limit === undefined ? filtered : filtered.slice(0, limit);
    },

    async entries(): Promise<SessionEntry[]> {
      const content = await readContent(file);
      const parsed = parseSessionFile(content);
      applyContent(state, content);
      return parsed.entries.map((record) => record.entry);
    },

    async count(): Promise<number> {
      applyContent(state, await readContent(file));
      return state.cursor;
    },

    async append(input: AppendInput): Promise<SessionRecord> {
      const { type, parentId, ...rest } = input;
      // 调用方（例如服务层从基座拿到的记录）可以自带 id / parentId / timestamp：
      // 这时必须**原样落盘**——id 与 parentId 就是树结构本身，重写它们等于改了历史。
      const providedId = typeof rest.id === "string" && rest.id !== "" ? rest.id : undefined;
      const providedTimestamp = typeof rest.timestamp === "string" ? rest.timestamp : undefined;
      const entry: SessionEntry = {
        ...rest,
        type,
        id: providedId ?? makeEntryId(state.ids),
        parentId: parentId === undefined ? state.leafId : parentId,
        timestamp: providedTimestamp ?? now().toISOString(),
      };
      const line = serializeEntry(entry);
      await appendLine(file, line);
      state.cursor += 1;
      state.leafId = entry.id;
      state.ids.add(entry.id);
      state.knownLength += Buffer.byteLength(line, "utf8");
      state.knownHash.update(line, "utf8");
      // 索引是派生数据：每追加一条就把它记的条目数推上去（文件仍是唯一权威）。
      const record: SessionRecord = { seq: state.cursor, entry };
      await onAppend?.(record);
      return record;
    },

    async repairTail(): Promise<TailRepair> {
      const truncatedBytes = await truncateToLastNewline(file);
      applyContent(state, await readContent(file));
      return { truncatedBytes, cursor: state.cursor };
    },

    async detectRewrite(): Promise<RewriteDetection> {
      const bytes = await readFile(file);
      const shrank = bytes.length < state.knownLength;
      const prefixSame =
        !shrank &&
        hashOfBytes(bytes.subarray(0, state.knownLength)) === state.knownHash.copy().digest("hex");
      applyContent(state, bytes.toString("utf8"));
      return { rewritten: shrank || !prefixSame, cursor: state.cursor };
    },
  };
}

function hashOfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createSessionRepo(options: {
  paths: SessionRoot;
  cwd: string;
  id?: string;
  createdAt?: Date;
  parentSession?: string;
  now?: () => Date;
  onAppend?: (record: SessionRecord) => Promise<void>;
}): Promise<SessionRepo> {
  const now = options.now ?? ((): Date => new Date());
  const createdAt = options.createdAt ?? now();
  const id = options.id ?? createSessionId(createdAt);
  assertSafeSessionId(id);

  const bucket = sessionBucketWithin(options.paths.sessions, options.cwd);
  await mkdir(bucket, { recursive: true, mode: 0o700 });
  const file = resolveWithin(bucket, sessionFileName(createdAt, id));

  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: createdAt.toISOString(),
    cwd: options.cwd,
    ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
  };

  try {
    const handle = await openFile(file, "wx", 0o600);
    try {
      await handle.writeFile(serializeEntry(header), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new StorageError("session_broken", `创建会话失败（标识可能已被占用）：${file}`, {
      file,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  return buildRepo({
    id,
    cwd: options.cwd,
    file,
    createdAt,
    state: stateFromContent(serializeEntry(header)),
    now,
    onAppend: options.onAppend,
  });
}

/** 按 id 打开会话；找不到返回 undefined（不抛错——"列出"与"打开"是两条不同的路径）。 */
export async function openSessionRepo(options: {
  paths: SessionRoot;
  id: string;
  cwd?: string;
  now?: () => Date;
  onAppend?: (record: SessionRecord) => Promise<void>;
}): Promise<SessionRepo | undefined> {
  assertSafeSessionId(options.id);
  const now = options.now ?? ((): Date => new Date());

  for (const bucket of await listBuckets(options.paths.sessions, options.cwd)) {
    const name = await findFileInBucket(bucket, options.id);
    if (name === undefined) continue;
    const file = join(bucket, name);
    const content = await readContent(file);
    const parsed = parseSessionFile(content);
    if (parsed.header === null) continue; // 非会话文件或损坏到没有 header：跳过
    return buildRepo({
      id: parsed.header.id,
      cwd: parsed.header.cwd,
      file,
      createdAt: new Date(parsed.header.timestamp),
      state: stateFromContent(content),
      now,
      onAppend: options.onAppend,
    });
  }
  return undefined;
}

async function findFileInBucket(bucket: string, id: string): Promise<string | undefined> {
  const entries = await readdir(bucket, { withFileTypes: true }).catch(() => []);
  return entries.find(
    (entry) =>
      entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(`_${id}.jsonl`),
  )?.name;
}

/** 会话桶列表：给了项目目录就先看那个桶（绝大多数查询都是"当前项目"）。 */
async function listBuckets(sessionsRoot: string, cwd?: string): Promise<string[]> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("--") && entry.name.endsWith("--"),
    )
    .map((entry) => join(sessionsRoot, entry.name));
  if (cwd === undefined) return dirs;
  const preferred = sessionBucketWithin(sessionsRoot, cwd);
  return [...dirs.filter((dir) => dir === preferred), ...dirs.filter((dir) => dir !== preferred)];
}
