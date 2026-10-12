/**
 * 来源内容的哈希：本地目录来源的「插件内容变没变」靠它判定。
 *
 * 有界的走查（文件数 / 字节数 / 深度都有上限，跳过 `.git` 与 `node_modules`）：宁可返回 null
 * 让调用方放弃这次判定，也不把一次设置页操作拖成大目录的慢查询。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  PLUGIN_HASH_MAX_BYTES,
  PLUGIN_HASH_MAX_DEPTH,
  PLUGIN_HASH_MAX_FILES,
  PLUGIN_HASH_SKIP_DIRNAMES,
} from "../../constants/plugins";

export type DirectoryHash = {
  /** 内容哈希：相对路径 + 字节数 + 内容，三项任一变化都会变 */
  hash: string;
  files: number;
  bytes: number;
};

/** 跳过这些目录：它们与「插件内容」无关，且体量可能极大 */
const SKIPPED = new Set<string>(PLUGIN_HASH_SKIP_DIRNAMES);

const toPosix = (path: string): string => path.split(sep).join("/");

/** 递归收集待哈希的文件（相对路径，已排序）；超限即返回 null */
const collectFiles = (
  root: string,
  dir: string,
  depth: number,
  acc: { files: string[]; bytes: number },
): boolean => {
  if (depth > PLUGIN_HASH_MAX_DEPTH) return true;
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return false;
  }

  for (const name of entries) {
    const path = join(dir, name);
    let isDirectory = false;
    let size = 0;
    try {
      const stat = statSync(path);
      isDirectory = stat.isDirectory();
      size = stat.size;
    } catch {
      return false;
    }
    if (isDirectory) {
      if (SKIPPED.has(name)) continue;
      if (!collectFiles(root, path, depth + 1, acc)) return false;
      continue;
    }
    acc.files.push(toPosix(relative(root, path)));
    acc.bytes += size;
    if (acc.files.length > PLUGIN_HASH_MAX_FILES || acc.bytes > PLUGIN_HASH_MAX_BYTES) return false;
  }
  return true;
};

/** 目录内容哈希；读不动或超限时返回 null（调用方按「这次不判定」处理） */
export const hashDirectory = (dir: string): DirectoryHash | null => {
  const acc = { files: [] as string[], bytes: 0 };
  if (!collectFiles(dir, dir, 0, acc)) return null;

  const digest = createHash("sha256");
  for (const file of acc.files) {
    digest.update(file);
    digest.update("\0");
    try {
      const content = readFileSync(join(dir, file));
      digest.update(String(content.byteLength));
      digest.update("\0");
      digest.update(content);
    } catch {
      return null;
    }
    digest.update("\0");
  }
  return { hash: digest.digest("hex"), files: acc.files.length, bytes: acc.bytes };
};
