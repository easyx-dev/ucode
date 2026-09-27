import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

/**
 * 工作区文件 / Git 结构化查询通道（spec §4.7 的第 1 条通道）。
 *
 * **不能用工具调用代替**：文件树需要增量刷新、Git 图谱需要分页加载，
 * 用 bash 跑 `ls`/`git log` 来喂 UI 是把界面性能绑在命令解析上。
 * 这里直接给出结构化结果；构建成本是毫秒级（V-6 已验证）。
 */

const run = promisify(execFile);

/** 不该出现在文件树里的目录：版本库元数据、依赖、构建产物。 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "__pycache__",
]);

export type TreeEntry = {
  /** 相对工作区根的路径（前端直接用来渲染树）。 */
  path: string;
  name: string;
  kind: "file" | "dir";
  size?: number;
  mtime?: string;
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type GitChange = { path: string; status: string };

export async function workspaceTree(
  cwd: string,
  options: { path?: string; depth?: number; filter?: string } = {},
): Promise<{ root: string; entries: TreeEntry[] }> {
  const maxDepth = options.depth ?? 2;
  const base = resolveWorkspacePath(cwd, options.path ?? ".");
  const entries: TreeEntry[] = [];
  const filter = options.filter;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const children = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (child.name.startsWith(".") && child.name !== ".env.example") {
        if (child.isDirectory()) continue;
      }
      if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue;
      const absolute = join(dir, child.name);
      const path = relative(cwd, absolute);
      const kind = child.isDirectory() ? "dir" : "file";
      if (filter !== undefined && filter !== "" && !path.includes(filter)) {
        if (kind === "dir") await walk(absolute, depth + 1);
        continue;
      }
      const info = await stat(absolute).catch(() => undefined);
      entries.push({
        path,
        name: child.name,
        kind,
        ...(kind === "file" && info !== undefined ? { size: info.size } : {}),
        ...(info !== undefined ? { mtime: info.mtime.toISOString() } : {}),
      });
      if (kind === "dir") await walk(absolute, depth + 1);
      if (entries.length > 5_000) return;
    }
  }

  await walk(base, 1);
  return { root: cwd, entries };
}

export async function gitLog(
  cwd: string,
  options: { limit?: number; skip?: number } = {},
): Promise<{ commits: GitCommit[]; hasMore: boolean }> {
  const limit = options.limit ?? 30;
  const skip = options.skip ?? 0;
  const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
  try {
    const { stdout } = await run(
      "git",
      ["log", `--max-count=${limit + 1}`, `--skip=${skip}`, `--pretty=format:${format}`],
      { cwd, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const records = stdout
      .split("\x1e")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk !== "");
    const commits = records.slice(0, limit).map((record) => {
      const [hash = "", shortHash = "", author = "", date = "", subject = ""] =
        record.split("\x1f");
      return { hash, shortHash, author, date, subject };
    });
    return { commits, hasMore: records.length > limit };
  } catch {
    // 不是 Git 仓库（或没有 git）：返回空，不是错误
    return { commits: [], hasMore: false };
  }
}

export async function gitChanges(cwd: string): Promise<{ changes: GitChange[] }> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain=v1"], {
      cwd,
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const changes = stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));
    return { changes };
  } catch {
    return { changes: [] };
  }
}

export async function workspaceRead(
  cwd: string,
  options: { path: string; maxBytes?: number },
): Promise<{ path: string; content: string; truncated: boolean; size: number }> {
  const absolute = resolveWorkspacePath(cwd, options.path);
  const info = await stat(absolute);
  if (info.isDirectory()) throw new Error("这是一个目录，不是文件。");
  const maxBytes = options.maxBytes ?? 400_000;
  const buffer = await readFile(absolute);
  const truncated = buffer.length > maxBytes;
  return {
    path: options.path,
    content: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated,
    size: buffer.length,
  };
}

/** 路径安全：工作区查询不得读出工作区之外（spec §3.4 第 7 条的精神）。 */
export function resolveWorkspacePath(cwd: string, relativePath: string): string {
  const root = resolve(cwd);
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error(`路径越界：${relativePath}`);
  }
  return absolute;
}
