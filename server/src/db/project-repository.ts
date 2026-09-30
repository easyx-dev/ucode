/**
 * 项目空间仓储：用户登记的目录集合，供会话按 `cwd` 分组。
 *
 * 只保存「哪些目录算项目」这层元数据；会话与项目的归属靠 `session.cwd` 与
 * `project.path` 精确匹配（两者都经 `utils/path` 归一化），不建外键——
 * 外部导入的会话（`reconcile()` 落的行）也要能被正确归组。
 * 命名与 SQL 规则见 `docs/database.md`。
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { openDatabase } from "./index";

export type ProjectRecord = {
  id: string;
  /** 展示名；为 null 时客户端回落目录名 */
  name: string | null;
  /** 已归一化的绝对目录路径，唯一 */
  path: string;
  createdAt: string;
  updatedAt: string;
};

/** project 表的显式列清单。禁止 `SELECT *`：加列不应改变既有查询的结果形状 */
const PROJECT_COLUMNS = ["id", "name", "path", "created_at", "updated_at"].join(", ");

const rowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  path: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const toRecord = (row: z.infer<typeof rowSchema>): ProjectRecord => ({
  id: row.id,
  name: row.name,
  path: row.path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ProjectRepository {
  constructor(private readonly db = openDatabase()) {}

  list(): ProjectRecord[] {
    return this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM project ORDER BY created_at DESC`)
      .all()
      .map((row) => toRecord(rowSchema.parse(row)));
  }

  find(id: string): ProjectRecord | undefined {
    const row = this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ?`).get(id);
    return row ? toRecord(rowSchema.parse(row)) : undefined;
  }

  findByPath(path: string): ProjectRecord | undefined {
    const row = this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE path = ?`).get(path);
    return row ? toRecord(rowSchema.parse(row)) : undefined;
  }

  /** 登记一个目录；`path` 唯一，重复登记由调用方先 `findByPath` 做幂等 */
  create(path: string, name: string | null = null): ProjectRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO project (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, name, path, now, now);
    return { id, name, path, createdAt: now, updatedAt: now };
  }

  /** 改名；不更新 `updated_at`，避免改名影响分组排序口径 */
  rename(id: string, name: string): void {
    this.db.prepare("UPDATE project SET name = ? WHERE id = ?").run(name, id);
  }

  /** 硬删本表行；会话不受影响，按 `cwd` 匹配不到项目时回落「默认」分组 */
  delete(id: string): void {
    this.db.prepare("DELETE FROM project WHERE id = ?").run(id);
  }
}
