/**
 * SQLite 连接与 schema 迁移。
 *
 * 数据库放 `$APP_HOME/app/app.db`，只保存应用自己的会话元数据与索引；
 * 消息正文仍由 pi 写在 JSONL 里。schema 版本记在 `PRAGMA user_version`。
 *
 * 迁移只追加：已发布的 DDL 不得再改，改 schema 就加新版本项。
 * 项目处于开发初期，破坏性变更直接改现有版本项、本地删库重建即可，不写数据迁移。
 * 规则见 `docs/database.md`。
 */
import { DatabaseSync } from "node:sqlite";

import { env } from "../env";

/** 当前 schema 版本；新增迁移时递增并补 `migrations` 项 */
export const SCHEMA_VERSION = 12;

/** 版本号（从 1 开始）-> 该版本要执行的 DDL */
const migrations: Record<number, string> = {
  1: `
    CREATE TABLE session (
      id              TEXT PRIMARY KEY,
      name            TEXT,
      cwd             TEXT,
      model           TEXT,
      thinking_level  TEXT,
      mode            TEXT,
      source_path     TEXT,
      preview         TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      deleted_at      TEXT
    );
    CREATE INDEX idx_session_updated_at ON session(updated_at DESC);
  `,
  // 子智能体：子会话记父会话 id 与角色 slug
  2: `
    ALTER TABLE session ADD COLUMN parent_session_id TEXT;
    ALTER TABLE session ADD COLUMN agent TEXT;
    CREATE INDEX idx_session_parent ON session(parent_session_id);
  `,
  // 会话分叉：新会话记分叉来源会话 id
  3: `
    ALTER TABLE session ADD COLUMN forked_from_session_id TEXT;
  `,
  // 目标模式：会话目标状态以 JSON 存一列
  4: `
    ALTER TABLE session ADD COLUMN goal_state TEXT;
  `,
  // 附件：内容寻址的元数据；字节在 $APP_HOME/app/attachments/<id>，见 plans/input-commands-skills.md
  // `referenced_at` 为空表示「只被草稿引用过、随时可过期」，被消息引用后置为时间且不再回退
  5: `
    CREATE TABLE attachment (
      id            TEXT PRIMARY KEY,
      mime_type     TEXT NOT NULL,
      name          TEXT,
      size          INTEGER NOT NULL,
      created_at    TEXT NOT NULL,
      referenced_at TEXT
    );
    CREATE INDEX idx_attachment_created_at ON attachment(created_at);
  `,
  // 会话级权限档位：命中 ask 时弹审批还是自动放行（见 docs/modes-and-permissions.md）
  6: `
    ALTER TABLE session ADD COLUMN permission_mode TEXT;
  `,
  // 登录会话：浏览器会话 token 对应的可撤销会话（见 plans/service-and-auth.md §3.4）
  // 库内只存 token 的 sha256，明文只在签发时回一次；id 是可展示 / 可撤销的 uuid
  7: `
    CREATE TABLE auth_session (
      id            TEXT PRIMARY KEY,
      token_hash    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      revoked_at    TEXT,
      label         TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX idx_auth_session_token_hash ON auth_session(token_hash);
    CREATE INDEX idx_auth_session_expires_at ON auth_session(expires_at);
  `,
  // 侧栏置顶与已读：`pinned_at` 非空即置顶，`last_read_at` 用于未读判定（见 plans/ui 侧栏重构）
  8: `
    ALTER TABLE session ADD COLUMN pinned_at TEXT;
    ALTER TABLE session ADD COLUMN last_read_at TEXT;
  `,
  // 项目：按会话 cwd 归口的偏好（展示名 + 最近一次选择的会话参数），见 docs/database.md
  9: `
    CREATE TABLE project (
      id               TEXT PRIMARY KEY,
      path             TEXT NOT NULL,
      name             TEXT,
      model            TEXT,
      thinking_level   TEXT,
      mode             TEXT,
      permission_mode  TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_project_path ON project(path);
  `,
  // 项目在侧栏里的次序：拖拽排序写回；为空表示还没排过，排在排过的后面（见 docs/database.md）
  10: `
    ALTER TABLE project ADD COLUMN sort_order INTEGER;
  `,
  // 项目级记忆开关的覆盖：NULL 表示未设过（跟随全局开关），0 / 1 为显式关 / 开
  11: `
    ALTER TABLE project ADD COLUMN memory_enabled INTEGER;
  `,
  // 会话当前在改的设计稿：指针随会话持久化，重启后 agent 与画布仍指向同一份
  // 只记路径，稿子文件本身不记任何会话信息
  12: `
    ALTER TABLE session ADD COLUMN design_path TEXT;
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
