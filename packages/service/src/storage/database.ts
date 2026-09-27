import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.ts";

/**
 * 打开服务自己的数据库并把它迁到最新 schema。
 *
 * 单文件 + WAL：写会话与读索引不互相阻塞，多个壳的查询能并行；
 * `busy_timeout` 兜底"另一个进程（CLI 的只读查询）短暂持锁"的情况。
 * 注意 `node:sqlite` 是同步 API：长查询会占住事件循环，模块里的大查询要走索引而不是全表扫。
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  migrate(database);
  return database;
}

/** 按水位应用缺失的迁移；一条迁移一个事务，失败整体回滚。返回迁移后的水位。 */
export function migrate(database: DatabaseSync): number {
  const current = readSchemaVersion(database);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.exec("BEGIN");
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return readSchemaVersion(database);
}

export function readSchemaVersion(database: DatabaseSync): number {
  const row: unknown = database.prepare("PRAGMA user_version").get();
  if (typeof row !== "object" || row === null) return 0;
  const value = (row as { user_version?: unknown }).user_version;
  return typeof value === "number" ? value : 0;
}
