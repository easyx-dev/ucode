/** /api/v1/fs：文件系统浏览（目录选择器与后续文件预览器共用）与新建目录 */
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ERROR_CODES,
  type FsEntry,
  type FsListInput,
  type FsListResponse,
  type FsMkdirInput,
  type FsMkdirResponse,
  fsListInputSchema,
  fsMkdirInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";
import { parentPathOf, resolveExistingPath, resolveTargetPath } from "../../utils/path";

/** 读单个目录项；断链的符号链接与特殊文件返回 null，由调用方过滤 */
const readEntry = (dir: string, name: string): FsEntry | null => {
  const path = join(dir, name);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }

  const isDirectory = stats.isDirectory();
  if (!isDirectory && !stats.isFile()) return null;
  return {
    name,
    path,
    type: isDirectory ? "directory" : "file",
    size: isDirectory ? 0 : stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
};

/** 目录在前、各自按名称排序，保证前端拿到的顺序稳定 */
const byTypeThenName = (a: FsEntry, b: FsEntry): number =>
  a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1;

const listDirectory = (input: FsListInput): FsListResponse => {
  const path = resolveExistingPath(input.path ?? homedir());
  const needle = input.q?.trim().toLowerCase();
  const entries = readdirSync(path)
    .map((name) => readEntry(path, name))
    .filter((entry): entry is FsEntry => entry !== null)
    .filter((entry) => input.type === "all" || entry.type === input.type)
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
    .sort(byTypeThenName);

  return { path, parent: parentPathOf(path), entries, total: entries.length };
};

const createDirectory = (input: FsMkdirInput): FsMkdirResponse => {
  const target = resolveTargetPath(input.path);
  try {
    // 非递归：父目录不存在时抛错，避免手滑建出一串目录
    mkdirSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new AppError(ERROR_CODES.pathExists, `目录已存在：${input.path}`, 400, undefined, {
        path: input.path,
      });
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new AppError(ERROR_CODES.pathNotFound, `路径不存在：${input.path}`, 400, undefined, {
        path: input.path,
      });
    }
    // 权限不足、只读文件系统等：既非「不存在」也非「已存在」，单独归类
    throw new AppError(ERROR_CODES.mkdirFailed, `创建目录失败：${input.path}`, 400, undefined, {
      path: input.path,
    });
  }
  return { path: resolveExistingPath(target) };
};

export const createFsRoute = () => {
  const router = new Hono();

  router.post("/list", jsonBody(fsListInputSchema), (c) =>
    c.json(ok(listDirectory(c.req.valid("json")))),
  );

  router.post("/mkdir", jsonBody(fsMkdirInputSchema), (c) =>
    c.json(ok(createDirectory(c.req.valid("json")))),
  );

  return router;
};
