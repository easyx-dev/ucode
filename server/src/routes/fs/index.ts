/** /api/v1/fs：文件系统浏览、新建目录、按名检索与读取文件（读逻辑在 `lib/file-content`） */
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  createFindToolDefinition,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
  ERROR_CODES,
  type FsEntry,
  type FsListInput,
  type FsListResponse,
  type FsMkdirInput,
  type FsMkdirResponse,
  type FsSearchInput,
  type FsSearchResponse,
  fsListInputSchema,
  fsMkdirInputSchema,
  fsReadInputSchema,
  fsSearchInputSchema,
} from "@ucode/contracts";
import fuzzysort from "fuzzysort";
import { Hono } from "hono";

import { FS_SEARCH_MAX_SCAN } from "../../constants";
import { readFileContent } from "../../lib/file-content";
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

/** 相对 base 的候选：目录以 `/` 结尾（与 pi find / fd 的输出一致） */
type SearchCandidate = { rel: string; entry: FsEntry };

/** 候选按 base 缓存的时间；输入 `@` 时每个按键都会查一次，缓存避免重复跑 fd */
const SEARCH_CACHE_MS = 10_000;

const searchCache = new Map<string, { at: number; items: SearchCandidate[]; truncated: boolean }>();

/** fd 输出里可能混入的提示行（结果截断 / 无结果） */
const isNoticeLine = (line: string): boolean =>
  line.startsWith("[") || line === "No files found matching pattern";

/**
 * 用 pi 的 find（fd，尊重 .gitignore、含隐藏文件）列出 base 下的全部文件与目录，转成候选。
 * 与 opencode 同口径：先备好「全部文件 + 全部目录」（目录带尾随 `/`），再对路径做模糊匹配。
 */
const scanCandidates = async (
  base: string,
): Promise<{ items: SearchCandidate[]; truncated: boolean }> => {
  const find = createFindToolDefinition(base);
  const result = await find.execute(
    "fs-search",
    { pattern: "**/*", path: ".", limit: FS_SEARCH_MAX_SCAN },
    undefined,
    undefined,
    // find 只读 `ctx.cwd`；其余字段我们不需要，故只给最小上下文
    { cwd: base } as unknown as ExtensionToolContext,
  );
  const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

  const items: SearchCandidate[] = [];
  for (const raw of text.split("\n")) {
    const rel = raw.trim();
    if (!rel || isNoticeLine(rel)) continue;
    const isDirectory = rel.endsWith("/");
    const clean = isDirectory ? rel.slice(0, -1) : rel;
    const slash = clean.lastIndexOf("/");
    // 复用 readEntry 拿类型 / 大小 / 时间；断链等异常条目跳过
    const entry = readEntry(
      slash < 0 ? base : join(base, clean.slice(0, slash)),
      clean.slice(slash + 1),
    );
    if (entry) items.push({ rel, entry });
  }

  const truncated = Boolean(result.details?.resultLimitReached || result.details?.truncation);
  return { items, truncated };
};

const candidatesOf = async (
  base: string,
): Promise<{ items: SearchCandidate[]; truncated: boolean }> => {
  const cached = searchCache.get(base);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached;

  let items: SearchCandidate[] = [];
  let truncated = false;
  try {
    ({ items, truncated } = await scanCandidates(base));
  } catch {
    // fd 不可用 / 路径异常：退化为空候选，不阻断输入
  }
  const result = { at: Date.now(), items, truncated };
  searchCache.set(base, result);
  return result;
};

/** 归一化查询：去首尾空白、`\` → `/`、去掉开头的 `./`（`@./` 等价于列出根目录） */
const normalizeQuery = (raw: string | undefined): string =>
  (raw ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/, "");

/**
 * 文件检索：对「全部文件 + 全部目录」的相对路径做模糊匹配（fuzzysort），按得分排序返回。
 * 与 opencode 同口径：匹配目标是路径而非文件名，所以 `src/`、`src/a`、`core/ind` 都能命中。
 */
const searchFiles = async (input: FsSearchInput): Promise<FsSearchResponse> => {
  const base = resolveExistingPath(input.path ?? homedir());
  const { items, truncated } = await candidatesOf(base);
  const query = normalizeQuery(input.q);

  if (!query) {
    return {
      path: base,
      entries: items.slice(0, input.limit).map((item) => item.entry),
      truncated: truncated || items.length > input.limit,
    };
  }

  const results = fuzzysort.go(query, items, { key: "rel", limit: input.limit });
  return {
    path: base,
    entries: results.map((result) => result.obj.entry),
    truncated: truncated || results.length === input.limit,
  };
};

export const createFsRoute = () => {
  const router = new Hono();

  router.post("/list", jsonBody(fsListInputSchema), (c) =>
    c.json(ok(listDirectory(c.req.valid("json")))),
  );

  router.post("/search", jsonBody(fsSearchInputSchema), async (c) =>
    c.json(ok(await searchFiles(c.req.valid("json")))),
  );

  router.post("/mkdir", jsonBody(fsMkdirInputSchema), (c) =>
    c.json(ok(createDirectory(c.req.valid("json")))),
  );

  router.post("/read", jsonBody(fsReadInputSchema), (c) =>
    c.json(ok(readFileContent(c.req.valid("json")))),
  );

  return router;
};
