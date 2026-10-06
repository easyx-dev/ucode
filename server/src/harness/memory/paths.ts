/**
 * 记忆的项目目录推导：一个会话的工作目录对应一个记忆目录。
 *
 * 目录名用「目录末段 + 绝对路径短哈希」：末段便于在文件管理器里辨认是哪个项目，
 * 哈希保证不同路径（含同名目录）不会撞车。工作目录由会话决定、不来自工具参数，故不需要路径穿越校验。
 */
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { MEMORY_DIRNAME, MEMORY_INDEX_FILENAME, MEMORY_PROJECTS_DIRNAME } from "../../constants";

const HASH_LENGTH = 12;
const LABEL_MAX_LENGTH = 40;

/** 目录名里不安全或不可见的字符统一换成 `-`，并去掉首尾分隔符 */
const sanitizeLabel = (value: string): string =>
  value
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, LABEL_MAX_LENGTH);

/** 项目的稳定目录名；同一路径总是得到同一名字，迁移 / 改名不会命中 */
export const projectDirName = (cwd: string): string => {
  const absolute = resolve(cwd);
  const label = sanitizeLabel(basename(absolute)) || "project";
  const hash = createHash("sha1").update(absolute).digest("hex").slice(0, HASH_LENGTH);
  return `${label}-${hash}`;
};

export const memoryProjectDir = (cwd: string, appDir: string): string =>
  resolve(appDir, MEMORY_DIRNAME, MEMORY_PROJECTS_DIRNAME, projectDirName(cwd));

export const memoryIndexPath = (cwd: string, appDir: string): string =>
  resolve(memoryProjectDir(cwd, appDir), MEMORY_INDEX_FILENAME);
