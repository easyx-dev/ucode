/**
 * SQLite 连接与 schema 迁移。
 *
 * 数据库放 `$APP_HOME/app/app.db`，只保存应用自己的会话元数据与索引；
 * 消息正文仍由 pi 写在 JSONL 里。schema 版本记在 `PRAGMA user_version`。
 *
 * 迁移只追加：已发布版本的 DDL 不得再改，改 schema 就加新版本项。
 * 项目处于开发初期，破坏性变更直接改现有版本项、本地删库重建即可，不写数据迁移。
 * 规则见 `docs/database.md`。
 */
import { DatabaseSync } from "node:sqlite";

import { env } from "../env";

/** 当前 schema 版本；新增迁移时递增并补 `migrations` 项 */
export const SCHEMA_VERSION = 3;

/** 版本号（从 1 开始）-> 该版本要执行的 DDL */
const migrations: Record<number, string> = {
  1: `
    CREATE TABLE session (
      id             TEXT PRIMARY KEY,
      name           TEXT,
      cwd            TEXT,
      model          TEXT,
      thinking_level TEXT,
      pi_name        TEXT,
      pi_cwd         TEXT,
      source_path    TEXT,
      persisted      INTEGER NOT NULL DEFAULT 0,
      entry_count    INTEGER NOT NULL DEFAULT 0,
      message_count  INTEGER NOT NULL DEFAULT 0,
      preview        TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX idx_session_updated_at ON session(updated_at DESC);
  `,
  2: `
    CREATE TABLE project (
      id         TEXT PRIMARY KEY,
      name       TEXT,
      path       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  3: `
    ALTER TABLE session ADD COLUMN mode TEXT;
    ALTER TABLE session ADD COLUMN workspace_dir TEXT;
  `,
};

/** 打开数据库并跑到最新 schema；WAL + 外键 + busy_timeout 都是单进程读写的基本保障 */
export const openDatabase = (path: string = env.dbPath): DatabaseSync => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
};

const migrate = (db: DatabaseSync): void => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const current = row?.user_version ?? 0;

  for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
    const sql = migrations[version];
    if (!sql) throw new Error(`缺少 SQLite 迁移脚本：v${version}`);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
};
