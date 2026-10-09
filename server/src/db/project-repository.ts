/**
 * 项目仓储：按会话工作目录（cwd）归口的偏好——侧栏展示用的名称，以及「最近一次在该项目里选择的」
 * 模型 / 思考档位 / 模式 / 权限档位。
 *
 * 项目是应用自己的概念（会话文件里没有对应表示），行随会话创建登记、不提供删除；
 * 命名、SQL 与类型映射规则见 `docs/database.md`。
 */
import { randomUUID } from "node:crypto";

import type { PermissionMode, ThinkingPreference } from "@ucode/contracts";
import { z } from "zod";

import { openDatabase } from "./index";

/** 可写回项目的会话参数；未给的字段不动（写回只覆盖用户这次显式选择的那几项） */
export type ProjectDefaultsPatch = {
  model?: string;
  thinkingLevel?: ThinkingPreference;
  mode?: string;
  permissionMode?: PermissionMode;
};

export type ProjectRecord = {
  id: string;
  /** 归一化后的绝对路径；项目的自然键 */
  path: string;
  name: string | null;
  /** 以下四项存的是文本，读到非法枚举值时由上层按「未设置」处理 */
  model: string | null;
  thinkingLevel: string | null;
  mode: string | null;
  permissionMode: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 显式列清单。禁止 `SELECT *`：加列不应改变既有查询的结果形状 */
const PROJECT_COLUMNS = [
  "id",
  "path",
  "name",
  "model",
  "thinking_level",
  "mode",
  "permission_mode",
  "created_at",
  "updated_at",
].join(", ");

/** 列表排序：最近写过的项目在前；顺序只影响接口输出，客户端一律按路径取用 */
const PROJECT_ORDER = "ORDER BY updated_at DESC";

const rowSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string().nullable(),
  model: z.string().nullable(),
  thinking_level: z.string().nullable(),
  mode: z.string().nullable(),
  permission_mode: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

type ProjectRow = z.infer<typeof rowSchema>;

const rowToRecord = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  path: row.path,
  name: row.name,
  model: row.model,
  thinkingLevel: row.thinking_level,
  mode: row.mode,
  permissionMode: row.permission_mode,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ProjectRepository {
  constructor(private readonly db = openDatabase()) {}

  find(path: string): ProjectRecord | undefined {
    const row = this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE path = ?`).get(path);
    return row ? rowToRecord(rowSchema.parse(row)) : undefined;
  }

  list(): ProjectRecord[] {
    return this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM project ${PROJECT_ORDER}`)
      .all()
      .map((row) => rowToRecord(rowSchema.parse(row)));
  }

  /**
   * 删掉不在 `keepPaths` 里的行（启动对账清理无主项目，见 `harness/project` 的 `reconcile`），
   * 返回被删的路径。逐行按 `path` 删：始终带 `WHERE`，也不受参数个数上限影响。
   */
  deleteOrphans(keepPaths: readonly string[]): string[] {
    const keep = new Set(keepPaths);
    const removed: string[] = [];
    for (const record of this.list()) {
      if (keep.has(record.path)) continue;
      this.db.prepare("DELETE FROM project WHERE path = ?").run(record.path);
      removed.push(record.path);
    }
    return removed;
  }

  /**
   * 登记一行（已存在则整条不动）。会话创建时调用，让项目先于任何显式设置存在；
   * 不改 `updated_at`——登记不是一次改动。
   */
  ensure(path: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO project (id, path, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO NOTHING",
      )
      .run(randomUUID(), path, now, now);
  }

  /** 改名；`name` 为 null 表示清空（界面回落目录末段）。行不存在时补建，供老项目直接改名 */
  setName(path: string, name: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project (id, path, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), path, name, now, now);
  }

  /**
   * 写回会话参数：只覆盖这次给到的字段（`COALESCE` 合并），其余保持原值。
   * 行不存在时补建，于是「老会话第一次改参数」也顺带把项目登记上。
   */
  rememberDefaults(path: string, patch: ProjectDefaultsPatch): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project (id, path, model, thinking_level, mode, permission_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           model = COALESCE(excluded.model, project.model),
           thinking_level = COALESCE(excluded.thinking_level, project.thinking_level),
           mode = COALESCE(excluded.mode, project.mode),
           permission_mode = COALESCE(excluded.permission_mode, project.permission_mode),
           updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        path,
        patch.model ?? null,
        patch.thinkingLevel ?? null,
        patch.mode ?? null,
        patch.permissionMode ?? null,
        now,
        now,
      );
  }
}
