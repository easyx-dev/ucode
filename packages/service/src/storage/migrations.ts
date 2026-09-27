export type Migration = {
  version: number;
  name: string;
  statements: string[];
};

/**
 * schema 迁移表。
 *
 * 只增不改：已发布的迁移语句永不修改（用户的库里已经按老语句建过表），新结构一律追加一条。
 * 水位记在 SQLite 的 `PRAGMA user_version` 里，不额外建表——少一张表就少一处不一致。
 *
 * 各业务模块的表（任务 / 记忆 / 钩子 / 市场 / 节点 …）在模块迁入服务层时按序追加，
 * 不预先在这里凭空设计它们的字段。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "服务元信息、会话索引、待决交互",
    statements: [
      `CREATE TABLE service_meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       ) STRICT`,
      `CREATE TABLE sessions (
         id TEXT PRIMARY KEY,
         cwd TEXT NOT NULL,
         name TEXT,
         first_message TEXT,
         autonomy TEXT NOT NULL DEFAULT 'confirm',
         entry_count INTEGER NOT NULL DEFAULT 0,
         last_seq INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         archived_at INTEGER
       ) STRICT`,
      "CREATE INDEX sessions_updated_idx ON sessions(updated_at DESC)",
      "CREATE INDEX sessions_cwd_idx ON sessions(cwd)",
      `CREATE TABLE interactions (
         id TEXT PRIMARY KEY,
         session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         kind TEXT NOT NULL,
         payload TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         resolved_at INTEGER,
         resolution TEXT,
         responder TEXT
       ) STRICT`,
      "CREATE INDEX interactions_pending_idx ON interactions(session_id, resolved_at)",
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (latest, migration) => Math.max(latest, migration.version),
  0,
);
