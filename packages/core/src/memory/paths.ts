import { createHash } from "node:crypto";
import { basename, join } from "node:path";

/**
 * 项目级记忆的落盘位置（F-2.5）。
 *
 * 记忆按**工作区**隔离：同一个 `cwd` 永远映射到同一个目录，不同工作区互不干扰。
 * 目录名用 `slug-<hash16>` 而不是纯 slug，是为了避免不同路径同名工作区互相覆盖
 * （`~/a/api` 与 `~/b/api` 的 basename 都是 `api`）。
 */

export const MEMORY_INDEX_FILE = "MEMORY.md";
export const MEMORY_PROJECTS_DIR = "projects";

/** 记忆条目的分类（写入 frontmatter 的 `type`）。 */
export type MemoryType = "user" | "feedback" | "project" | "reference";
export const MEMORY_TYPES: readonly MemoryType[] = ["user", "feedback", "project", "reference"];

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

/** 记忆条目名：小写字母/数字/`._-`，不能是 `MEMORY`，不能含路径分隔符。 */
export function isSafeMemoryName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) && !/^memory$/i.test(name);
}

export function projectMemoryKey(cwd: string): string {
  const slug =
    basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project";
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return `${slug}-${hash}`;
}

/** `<memoriesRoot>/projects/<key>`。 */
export function projectMemoryDir(memoriesRoot: string, cwd: string): string {
  return join(memoriesRoot, MEMORY_PROJECTS_DIR, projectMemoryKey(cwd));
}

export function memoryIndexPath(dir: string): string {
  return join(dir, MEMORY_INDEX_FILE);
}

/** 条目文件路径；名字非法时抛错（调用方应先用 `isSafeMemoryName` 校验并给出可诊断信息）。 */
export function memoryFactPath(dir: string, name: string): string {
  if (!isSafeMemoryName(name)) {
    throw new Error(`非法的记忆条目名：${name}（只允许小写字母、数字、._-，且不能叫 MEMORY）。`);
  }
  return join(dir, `${name}.md`);
}
