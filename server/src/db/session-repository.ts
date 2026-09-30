/**
 * 会话仓储：应用自己的会话元数据与索引（覆盖值 + 列表缓存）的 SQLite 读写。
 *
 * 一张 `session` 表同时承担两件事：会话的本地状态（`name` / `cwd` / `model` /
 * `thinking_level` / `mode`）与列表展示用的缓存（`source_path` / `preview` / 时间）。
 * 消息正文不在这里，仍由 pi 写在 `sessions/*.jsonl`。
 * 命名、SQL 与删除规则见 `docs/database.md`。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SESSION_MODE,
  SESSION_MODES,
  type SessionMode,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@ucode/contracts";
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
  /** 会话模式；未设置时回落 `DEFAULT_SESSION_MODE` */
  mode?: SessionMode;
  /** 归档时间；非空表示已归档（软删） */
  deletedAt?: string;
};

/** 列表展示用的缓存字段，由 `core/session-index` 从 pi 会话对象提取 */
export type SessionIndex = {
  sourcePath: string;
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
  /** 已按白名单归一的会话模式 */
  mode: SessionMode;
  /** 会话正文文件；为 null 表示还没落盘 */
  sourcePath: string | null;
  preview: string;
  createdAt: string;
  updatedAt: string;
  /** 归档时间；非空表示已归档（软删） */
  deletedAt: string | null;
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
  "mode",
  "source_path",
  "preview",
  "created_at",
  "updated_at",
  "deleted_at",
].join(", ");

const rowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  cwd: z.string().nullable(),
  model: z.string().nullable(),
  thinking_level: z.string().nullable(),
  mode: z.string().nullable(),
  source_path: z.string().nullable(),
  preview: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

type SessionRow = z.infer<typeof rowSchema>;

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  name: row.name,
  cwd: row.cwd,
  model: row.model,
  thinkingLevel: row.thinking_level,
  mode: toSessionMode(row.mode),
  sourcePath: row.source_path,
  preview: row.preview,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

/** DB 里存的是文本，读到非法值时按「未设置」处理，避免脏数据把接口打挂 */
const toThinkingLevel = (value: string | null): ThinkingLevel | undefined =>
  value && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;

/** 会话模式同理：非法或缺失一律回落默认模式 */
const toSessionMode = (value: string | null): SessionMode =>
  value && (SESSION_MODES as readonly string[]).includes(value)
    ? (value as SessionMode)
    : DEFAULT_SESSION_MODE;

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
    mode: record.mode,
    ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
  };
};

export class SessionRepository {
  constructor(private readonly db = openDatabase()) {}

  /** 新建行：会话文件在首次 assistant 回复时才由 pi 落盘 */
  create(id: string, override: SessionOverride): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session (id, name, cwd, model, thinking_level, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        override.name ?? null,
        override.cwd ?? null,
        override.model ?? null,
        override.thinkingLevel ?? null,
        override.mode ?? null,
        now,
        now,
      );
  }

  find(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE id = ?`).get(id);
    return row ? toRecord(rowSchema.parse(row)) : undefined;
  }

  /** 覆盖值（不含列表缓存），供 pool / 序列化合并生效值 */
  get(id: string): SessionOverride {
    return overrideOf(this.find(id));
  }

  /** 覆盖值写入；不改 `updated_at`，重命名不应把会话顶到列表最前 */
  set(id: string, override: SessionOverride): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session (id, name, cwd, model, thinking_level, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, session.name),
           cwd = COALESCE(excluded.cwd, session.cwd),
           model = COALESCE(excluded.model, session.model),
           thinking_level = COALESCE(excluded.thinking_level, session.thinking_level),
           mode = COALESCE(excluded.mode, session.mode)`,
      )
      .run(
        id,
        override.name ?? null,
        override.cwd ?? null,
        override.model ?? null,
        override.thinkingLevel ?? null,
        override.mode ?? null,
        now,
        now,
      );
  }

  /** 硬删本表行；只给对账与测试用（用户动作一律走 `archive`，见 docs/database.md） */
  delete(id: string): void {
    this.db.prepare("DELETE FROM session WHERE id = ?").run(id);
  }

  /** 软删：只写 `deleted_at`，行与文件都保留 */
  archive(id: string): void {
    this.db
      .prepare("UPDATE session SET deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  list(): SessionRecord[] {
    return this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM session ORDER BY updated_at DESC`)
      .all()
      .map((row) => toRecord(rowSchema.parse(row)));
  }

  /** 全部会话 id（含已归档）；工作区孤儿清理据此判定「还有没有主」 */
  listIds(): string[] {
    return this.db
      .prepare("SELECT id FROM session")
      .all()
      .map((row) => (row as { id: string }).id);
  }

  /**
   * 列表查询：过滤与排序都下推到 SQL。
   * 已归档（`deleted_at` 非空）的行不参与，前端刷新后看不到归档的会话；
   * 还没落盘的行（`source_path` 为空）仍参与，让在途会话出现在列表里。
   */
  search(query: SessionSearchInput): SessionSearchResult {
    const needle = query.q?.trim().toLowerCase();
    const conditions = ["deleted_at IS NULL"];
    const params: string[] = [];

    if (needle) {
      const like = `%${escapeLike(needle)}%`;
      conditions.push(
        "(lower(id) LIKE ? ESCAPE '\\' OR lower(COALESCE(name, '')) LIKE ? ESCAPE '\\' OR lower(preview) LIKE ? ESCAPE '\\')",
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

  /** 生成落定后回写列表缓存；行不存在时顺带补建（例如外部导入的会话） */
  refresh(id: string, index: SessionIndex): void {
    this.db
      .prepare(
        `INSERT INTO session (id, source_path, preview, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_path = excluded.source_path,
           preview = excluded.preview,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(id, index.sourcePath, index.preview, index.createdAt, index.updatedAt);
  }

  /**
   * 启动时全量对账：以 JSONL 为准删除文件已消失的行。
   * 不再从文件还原元数据（外部导入能力已放弃），所以这里只做减法。
   */
  async reconcile(): Promise<void> {
    const infos = await SessionManager.listAll(env.sessionsRoot);
    const seen = new Set(infos.map((info) => info.id));

    for (const record of this.list()) {
      if (!seen.has(record.id)) this.delete(record.id);
    }
  }
}
