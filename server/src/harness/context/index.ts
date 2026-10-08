/**
 * `@` 上下文展开：把引用（文件 / 目录）读成内容，用不可信边界包裹后前置进正文。
 *
 * 只允许会话工作目录内的路径（realpath 后校验，防符号链接逃逸）；`path` 给绝对路径或相对会话
 * 工作目录的写法都行（编辑器插的是绝对路径，编辑重发回传的是相对写法）；目录给递归清单，
 * 文件按可选行范围切片；单文件与总量都有字节上限，超出截断并附注。
 */

import type { Dirent } from "node:fs";
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { type ContextRefInput, ERROR_CODES } from "@ucode/contracts";

import {
  CONTEXT_MAX_FILE_BYTES,
  CONTEXT_MAX_FILES,
  CONTEXT_MAX_TOTAL_BYTES,
  FS_SEARCH_SKIP_DIRS,
} from "../../constants";
import { AppError } from "../../lib/response";
import { wrapUntrusted } from "../tools/untrusted";

/** 目录清单的递归深度上限，避免深层目录拖垮扫描 */
const LISTING_MAX_DEPTH = 4;

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * 归一化待校验的目标路径：存在则取 realpath；不存在时对父目录取 realpath 再拼回末段，
 * 这样「不存在」不会因为父目录是符号链接（如 macOS 的 `/var` → `/private/var`）被误判为越界。
 */
const realTarget = (path: string): string => {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    try {
      return resolve(realpathSync(dirname(resolved)), basename(resolved));
    } catch {
      return resolved;
    }
  }
};

const isInside = (root: string, target: string): boolean =>
  target === root || target.startsWith(`${root}${sep}`);

const invalidPath = (code: string, message: string, path: string): AppError =>
  new AppError(code, `${message}：${path}`, 400, undefined, { path });

/** 有上限地读文件头（不做整文件读入，避免大文件撑爆内存） */
const readBounded = (path: string, max: number): { text: string; truncated: boolean } => {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(max + 1);
    const bytesRead = readSync(fd, buffer, 0, max + 1, 0);
    return {
      text: buffer.subarray(0, Math.min(bytesRead, max)).toString("utf8"),
      truncated: bytesRead > max,
    };
  } finally {
    closeSync(fd);
  }
};

/** 按 1-based 闭区间切片；缺省取整段 */
const sliceLines = (text: string, startLine?: number, endLine?: number): string => {
  if (startLine === undefined && endLine === undefined) return text;
  const lines = text.split("\n");
  const start = Math.max(0, (startLine ?? 1) - 1);
  const end = endLine === undefined ? lines.length : endLine;
  return lines.slice(start, end).join("\n");
};

/** 按字节上限截断到最近的字符边界 */
const truncateBytes = (text: string, max: number): { text: string; truncated: boolean } => {
  if (max <= 0) return { text: "", truncated: text.length > 0 };
  let used = 0;
  for (let index = 0; index < text.length; index += 1) {
    used += Buffer.byteLength(text[index] ?? "", "utf8");
    if (used > max) return { text: text.slice(0, index), truncated: true };
  }
  return { text, truncated: false };
};

/** 目录递归清单：跳过常见构建目录，条数与深度都受限 */
const listDirectory = (root: string, path: string): { body: string; truncated: boolean } => {
  const lines: string[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (truncated) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (lines.length >= CONTEXT_MAX_FILES) {
        truncated = true;
        return;
      }
      const child = resolve(dir, entry.name);
      const rel = relative(root, child) || entry.name;
      if (entry.isDirectory()) {
        if (FS_SEARCH_SKIP_DIRS.includes(entry.name)) continue;
        lines.push(`${rel}/`);
        if (depth > 0) walk(child, depth - 1);
      } else if (entry.isFile()) {
        lines.push(rel);
      }
    }
  };

  walk(path, LISTING_MAX_DEPTH);
  return { body: lines.join("\n"), truncated };
};

type ContextBody = { rel: string; body: string; truncated: boolean };

const readRef = (root: string, ref: ContextRefInput): ContextBody => {
  // 相对路径按**会话工作目录**解析：编辑重发时客户端回传的是还原出来的相对写法，
  // 而 `resolve` 单参版本会落到服务进程的 cwd 上（碰巧等于仓库根），那是错的
  const target = realTarget(resolve(root, ref.path));
  if (!isInside(root, target)) {
    throw invalidPath(ERROR_CODES.invalidRequest, "引用越出工作目录", ref.path);
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(target);
  } catch {
    throw invalidPath(ERROR_CODES.pathNotFound, "路径不存在", ref.path);
  }

  const rel = relative(root, target) || ".";
  if (stats.isDirectory()) {
    const listed = listDirectory(root, target);
    return { rel, body: listed.body, truncated: listed.truncated };
  }
  if (stats.isFile()) {
    const bounded = readBounded(target, CONTEXT_MAX_FILE_BYTES);
    return {
      rel,
      body: sliceLines(bounded.text, ref.startLine, ref.endLine),
      truncated: bounded.truncated,
    };
  }
  throw invalidPath(ERROR_CODES.pathNotFound, "不是文件或目录", ref.path);
};

const attributesOf = (ref: ContextRefInput, rel: string): Record<string, string> => {
  if (ref.startLine === undefined && ref.endLine === undefined) return { path: rel };
  const end = ref.endLine === undefined ? "" : String(ref.endLine);
  return { path: rel, lines: `${ref.startLine ?? 1}-${end}` };
};

/**
 * 把若干 `@` 引用展开成一段可前置进正文的文本；无引用返回空串。
 * 越界 / 不存在 / 类型不符抛可读错误，交给路由层回 400。
 */
export const expandContexts = (cwd: string, refs: readonly ContextRefInput[]): string => {
  if (refs.length === 0) return "";
  const root = realOrSelf(resolve(cwd));
  let remaining = CONTEXT_MAX_TOTAL_BYTES;
  const blocks: string[] = [];

  for (const ref of refs) {
    const { rel, body, truncated } = readRef(root, ref);
    const capped = truncateBytes(body, remaining);
    remaining -= Buffer.byteLength(capped.text, "utf8");
    const text = capped.truncated || truncated ? `${capped.text}\n…（内容已截断）` : capped.text;
    blocks.push(wrapUntrusted("context", attributesOf(ref, rel), text));
  }

  return blocks.join("\n\n");
};
