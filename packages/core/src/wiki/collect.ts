import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { DEFAULT_MAX_FILE_BYTES, type FilterReason, filterEntry, isSkippedDir } from "./filter.ts";

/**
 * 收集 Wiki 的素材（F-2.6）：按过滤规则遍历工作区并读入文件正文。
 *
 * 用**自建的遍历**而不是复用 `workspaceTree`：这里需要符号链接的判别（要跳过）与逐文件的
 * 大小/后缀判断，而 workspaceTree 的输出是给"展示"用的，不含这些信息。
 *
 * 三重预算（总字节 / 文件数 / 单文件字节）保证"再大的仓库也不会把上下文撑爆"，
 * 到顶就停止收集并标记 `truncatedByBudget`——**明说没读完**，而不是假装覆盖了全部。
 */

export type WikiSourceFile = { path: string; content: string; truncated: boolean };

export type WikiExclusion = { path: string; reason: FilterReason };

export type WikiCollection = {
  files: WikiSourceFile[];
  excluded: WikiExclusion[];
  totalBytes: number;
  /** 因为预算用尽而没读完（照实告诉用户，别让他以为 wik i包含了全部）。 */
  truncatedByBudget: boolean;
};

export type CollectOptions = {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
};

const DEFAULT_MAX_TOTAL_BYTES = 200_000;
const DEFAULT_MAX_FILES = 80;

export async function collectWikiSources(
  cwd: string,
  options: CollectOptions = {},
): Promise<WikiCollection> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const files: WikiSourceFile[] = [];
  const excluded: WikiExclusion[] = [];
  let totalBytes = 0;
  let truncatedByBudget = false;

  const queue: string[] = [""];
  while (queue.length > 0) {
    const relativeDir = queue.shift() as string;
    const absoluteDir = relativeDir === "" ? cwd : join(cwd, relativeDir);
    let entries: Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue; // 读不了的目录跳过，不让整体失败
    }

    for (const entry of entries) {
      const relativePath = relativeDir === "" ? entry.name : `${relativeDir}${sep}${entry.name}`;
      const absolutePath = join(cwd, relativePath);
      const isSymlink = entry.isSymbolicLink();

      if (entry.isDirectory() && !isSymlink) {
        if (isSkippedDir(entry.name)) {
          excluded.push({ path: `${relativePath}/`, reason: "skip-dir" });
          continue;
        }
        queue.push(relativePath);
        continue;
      }

      let size: number | undefined;
      if (!isSymlink) {
        try {
          size = (await lstat(absolutePath)).size;
        } catch {
          size = undefined;
        }
      }

      const verdict = filterEntry(
        {
          path: relativePath,
          kind: "file",
          ...(size === undefined ? {} : { size }),
          isSymlink,
        },
        { maxFileBytes },
      );
      if (!verdict.include) {
        excluded.push({ path: relativePath, reason: verdict.reason });
        continue;
      }

      if (files.length >= maxFiles || totalBytes >= maxTotalBytes) {
        truncatedByBudget = true;
        continue;
      }
      try {
        const buffer = await readFile(absolutePath);
        const truncated = buffer.length > maxFileBytes;
        const content = buffer.subarray(0, maxFileBytes).toString("utf8");
        files.push({ path: relativePath, content, truncated });
        totalBytes += content.length;
      } catch {
        excluded.push({ path: relativePath, reason: "binary" });
      }
    }
  }

  return { files, excluded, totalBytes, truncatedByBudget };
}

/** 相对路径 → 展示用（Windows 盘符下也统一成 `/`）。 */
export function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
