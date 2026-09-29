/**
 * SQLite 连接与 schema 迁移。
 *
 * 数据库放 `$APP_HOME/app/ucode.db`，只保存应用自己的会话元数据与索引；
 * 消息正文仍由 pi 写在 JSONL 里。schema 版本记在 `PRAGMA user_version`，
 * 每次新增迁移就补一条并从旧版本依次执行。
 */
import { DatabaseSync } from "node:sqlite";

import { env } from "../env";

/** 当前 schema 版本；新增迁移时递增并补 `migrations` 项 */
export const SCHEMA_VERSION = 1;

/** 版本号 -> 该版本要执行的 DDL */
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
    CREATE INDEX idx_session_updated ON session(updated_at DESC);
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
