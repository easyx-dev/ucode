/** 校验脚本共用的目录遍历工具 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/**
 * 递归列出 `root/dir` 下满足 `match` 的文件，返回仓库相对路径（统一用 `/` 分隔）。
 * 输出用相对路径，便于直接对照源码；目录不存在时返回空数组。
 */
export const listFiles = (
  root: string,
  dir: string,
  match: (absolutePath: string) => boolean,
): string[] => {
  const start = join(root, dir);
  if (!existsSync(start)) return [];

  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
        continue;
      }
      const absolute = join(current, entry.name);
      if (match(absolute)) result.push(relative(root, absolute).split("\\").join("/"));
    }
  };

  walk(start);
  return result;
};
