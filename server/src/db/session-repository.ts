/**
 * 会话仓储：应用自己的会话元数据与索引（覆盖值 + 列表字段）的 SQLite 读写。
 *
 * 一张 `session` 表同时承担两件事：草稿/覆盖值（`name` / `cwd` / `model` /
 * `thinking_level`）与 JSONL 派生索引（`pi_*` / `source_path` / 计数 / 时间）。
 * 消息正文不在这里，仍由 pi 写在 `sessions/*.jsonl`。
 * 命名、SQL 与删除规则见 `docs/database.md`。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS, type ThinkingLevel } from "@ucode/contracts";
import { z } from "zod";

import { env } from "../env";
import { openDatabase } from "./index";

/** 单会话的可覆盖项；未设置时回落到全局默认 */
export type SessionOverride = {
  /** 未落盘（还没有 assistant 回复）时的会话名兜底 */
  name?: string;
  /** 新建会话时指定的工作目录 */
  cwd?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/** JSONL 派生出来的索引字段，由 `core/session-index` 从 pi 会话对象提取 */
export type SessionIndex = {
  piName: string | null;
  piCwd: string | null;
  sourcePath: string;
  entryCount: number;
  messageCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  id: string;
  name: string | null;
  cwd: string | null;
  model: string | null;
  thinkingLevel: string | null;
  piName: string | null;
  piCwd: string | null;
  sourcePath: string | null;
  persisted: boolean;
  entryCount: number;
  messageCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionSearchInput = {
  q?: string;
  limit: number;
};

export type SessionSearchResult = {
  records: SessionRecord[];
  /** 过滤后的总数（未按 limit 截断） */
  total: number;
};

/** session 表的显式列清单。禁止 `SELECT *`：加列不应改变既有查询的结果形状 */
const SESSION_COLUMNS = [
  "id",
  "name",
  "cwd",
  "model",
  "thinking_level",
  "pi_name",
  "pi_cwd",
  "source_path",
  "persisted",
  "entry_count",
  "message_count",
  "preview",
  "created_at",
  "updated_at",
].join(", ");

const rowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  cwd: z.string().nullable(),
  model: z.string().nullable(),
  thinking_level: z.string().nullable(),
  pi_name: z.string().nullable(),
  pi_cwd: z.string().nullable(),
  source_path: z.string().nullable(),
  persisted: z.number(),
  entry_count: z.number(),
  message_count: z.number(),
  preview: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

type SessionRow = z.infer<typeof rowSchema>;

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  name: row.name,
  cwd: row.cwd,
  model: row.model,
  thinkingLevel: row.thinking_level,
  piName: row.pi_name,
  piCwd: row.pi_cwd,
  sourcePath: row.source_path,
  persisted: row.persisted === 1,
  entryCount: row.entry_count,
  messageCount: row.message_count,
  preview: row.preview,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** DB 里存的是文本，读到非法值时按「未设置」处理，避免脏数据把接口打挂 */
const toThinkingLevel = (value: string | null): ThinkingLevel | undefined =>
  value && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;

/** 搜索结果一律按字面量匹配，转义 LIKE 的 `%` / `_` / `\`（配合 `ESCAPE '\'`） */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** 从索引行取出覆盖值；与 `get` 同一口径，供已持有行的调用方复用 */
export const overrideOf = (record: SessionRecord | undefined): SessionOverride => {
  if (!record) return {};
  const thinkingLevel = toThinkingLevel(record.thinkingLevel);
  return {
    ...(record.name ? { name: record.name } : {}),
    ...(record.cwd ? { cwd: record.cwd } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
};

export class SessionRepository {
  constructor(private readonly db = openDatabase()) {}

  /** 新建草稿行：会话文件在首次 assistant 回复时才由 pi 落盘 */
  create(id: string, override: SessionOverride): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session (id, name, cwd, model, thinking_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        override.name ?? null,
        override.cwd ?? null,
        override.model ?? null,
        override.thinkingLevel ?? null,
        now,
        now,
      );
  }

  find(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE id = ?`).get(id);
    return row ? toRecord(rowSchema.parse(row)) : undefined;
  }

  /** 覆盖值（不含 JSONL 派生字段），供 pool / 序列化合并生效值 */
  get(id: string): SessionOverride {
    return overrideOf(this.find(id));
  }

  /** 覆盖值写入；不改 `updated_at`，重命名不应把会话顶到列表最前 */
  set(id: string, override: SessionOverride): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session (id, name, cwd, model, thinking_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, session.name),
           cwd = COALESCE(excluded.cwd, session.cwd),
           model = COALESCE(excluded.model, session.model),
           thinking_level = COALESCE(excluded.thinking_level, session.thinking_level)`,
      )
      .run(
        id,
        override.name ?? null,
        override.cwd ?? null,
        override.model ?? null,
        override.thinkingLevel ?? null,
        now,
        now,
      );
  }

  /** 硬删本表行；关联的内存池、事件订阅与 JSONL 文件由调用方按顺序清理（见 docs/database.md） */
  delete(id: string): void {
    this.db.prepare("DELETE FROM session WHERE id = ?").run(id);
  }

  /**
   * 清理过期草稿：只删 `persisted = 0` 且 `updated_at` 早于 cutoff 的行，
   * `keepIds` 内的活跃会话豁免（草稿只有覆盖值，没有 JSONL 与事件序号，删行即可）。
   * 草稿的 `updated_at` 就是创建时间——`set()` 不更新它，所以这里衡量的正是「多久没动过」。
   */
  deleteStaleDrafts(cutoffIso: string, keepIds: readonly string[] = []): number {
    const keepClause =
      keepIds.length > 0 ? ` AND id NOT IN (${keepIds.map(() => "?").join(", ")})` : "";
    const result = this.db
      .prepare(`DELETE FROM session WHERE persisted = 0 AND updated_at < ?${keepClause}`)
      .run(cutoffIso, ...keepIds);
    return Number(result.changes);
  }

  list(): SessionRecord[] {
    return this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM session ORDER BY updated_at DESC`)
      .all()
      .map((row) => toRecord(rowSchema.parse(row)));
  }

  /**
   * 列表查询：过滤与排序都下推到 SQL。
   * 草稿行（`persisted = 0`，尚未落盘）也参与，前端刷新后仍能看到未完成的会话；
   * 长期未使用的草稿由 `deleteStaleDrafts` 清理，不会无限堆在列表里。
   */
  search(query: SessionSearchInput): SessionSearchResult {
    const needle = query.q?.trim().toLowerCase();
    const conditions = ["(persisted = 0 OR source_path IS NOT NULL)"];
    const params: string[] = [];

    if (needle) {
      const like = `%${escapeLike(needle)}%`;
      conditions.push(
        "(lower(id) LIKE ? ESCAPE '\\' OR lower(COALESCE(pi_name, name, '')) LIKE ? ESCAPE '\\' OR lower(preview) LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like);
    }
    const where = conditions.join(" AND ");

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM session WHERE ${where}`)
      .get(...params) as { total?: number } | undefined;
    const rows = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM session WHERE ${where} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, query.limit);

    return {
      records: rows.map((row) => toRecord(rowSchema.parse(row))),
      total: totalRow?.total ?? 0,
    };
  }

  /** 生成落定后回写索引；行不存在时顺带补建（例如外部导入的会话） */
  refresh(id: string, index: SessionIndex): void {
    this.db
      .prepare(
        `INSERT INTO session (
           id, pi_name, pi_cwd, source_path, persisted,
           entry_count, message_count, preview, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           pi_name = excluded.pi_name,
           pi_cwd = excluded.pi_cwd,
           source_path = excluded.source_path,
           persisted = 1,
           entry_count = excluded.entry_count,
           message_count = excluded.message_count,
           preview = excluded.preview,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        index.piName,
        index.piCwd,
        index.sourcePath,
        index.entryCount,
        index.messageCount,
        index.preview,
        index.createdAt,
        index.updatedAt,
      );
  }

  /**
   * 启动时全量对齐：以 JSONL 为准补齐索引，并删除文件已消失的已落盘行。
   * 草稿行（persisted = 0）不属于文件，保留。
   */
  async reconcile(): Promise<void> {
    const infos = await SessionManager.listAll(env.sessionsRoot);
    const seen = new Set<string>();

    for (const info of infos) {
      seen.add(info.id);
      const existing = this.find(info.id);
      const updatedAt = info.modified.toISOString();
      // 文件没变时沿用已算好的条目数，避免重复解析
      const entryCount =
        existing && existing.sourcePath === info.path && existing.updatedAt === updatedAt
          ? existing.entryCount
          : SessionManager.open(info.path, env.sessionsRoot, info.cwd).getEntries().length;

      this.refresh(info.id, {
        piName: info.name ?? null,
        piCwd: info.cwd || null,
        sourcePath: info.path,
        entryCount,
        messageCount: info.messageCount,
        preview: info.firstMessage === "(no messages)" ? "" : info.firstMessage,
        createdAt: info.created.toISOString(),
        updatedAt,
      });
    }

    for (const record of this.list()) {
      if (record.persisted && !seen.has(record.id)) this.delete(record.id);
    }
  }
}
