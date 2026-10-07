/**
 * git 调用底座：固定参数白名单执行 git、向上找仓库根、把 repo 内相对路径收敛成安全入参。
 *
 * pi SDK 不提供任何 git API，这里直接用系统 git（零依赖）。所有命令都显式禁用外部 diff / textconv
 * 与分页，并强制 `core.quotepath=false`，避免 `.gitattributes` 触发外部程序、或非 ASCII 路径被转义。
 * 用户可控入参只有「仓库内相对路径」与「提交 hash」，两者都在这里校验后才拼进命令。
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";

import { GIT_MAX_BUFFER, GIT_TIMEOUT_MS } from "../../constants";
import { resolveExistingPath } from "../../utils/path";
import { AppError } from "../response";

export type GitRunResult = {
  stdout: string;
  /** 退出码；diff 类命令以 1 表示「有差异」，由调用方决定是否算失败 */
  code: number;
};

/**
 * 全局注入的只读参数（必须落在子命令**之前**）：不分页、路径不转义。
 * 注意 git 的全局选项与子命令选项不能混放：`--no-ext-diff` 这类 diff 选项放到前面会报未知选项，
 * 所以它们单独在 `DIFF_ARGS` 里，由 `runDiff` 拼在子命令之后。
 */
const GLOBAL_ARGS = ["--no-pager", "-c", "core.quotepath=false", "-c", "core.pager=cat"];

/**
 * 所有 diff 类命令共用的选项：不走外部 diff / textconv（`.gitattributes` 能借此拉起外部程序）、
 * 不上色。
 */
export const DIFF_ARGS = ["--no-ext-diff", "--no-textconv", "--no-color"];

const GIT_ENV = {
  // 只读操作不抢 index 锁，避免与服务里运行的 agent 同时操作仓库时互相等待
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C.UTF-8",
} as const;

/**
 * 执行一条白名单内的 git 子命令。`args` 由调用方给出，**不得**包含用户输入
 * （用户可控部分只能用 `--` 之后的位置参数，见 `runGitOnPaths`）。
 */
export const runGit = (cwd: string, args: readonly string[]): Promise<GitRunResult> =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      [...GLOBAL_ARGS, ...args],
      {
        cwd,
        env: { ...process.env, ...GIT_ENV },
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
          if (code === "ENOENT") {
            rejectPromise(
              new AppError(ERROR_CODES.gitUnavailable, "未找到 git 可执行文件", 500, undefined),
            );
            return;
          }
          // diff / show 以 1 表示「有差异」，不是失败；由调用方按需覆盖
          if (typeof code === "number") {
            resolvePromise({ stdout, code });
            return;
          }
          rejectPromise(
            new AppError(
              ERROR_CODES.gitFailed,
              `git 执行失败：${stderr.trim() || String(error)}`,
              500,
            ),
          );
          return;
        }
        resolvePromise({ stdout, code: 0 });
      },
    );
  });

/**
 * 带 diff 选项的执行：`args[0]` 必须是子命令。git 的全局选项与子命令选项不能混放，
 * 所以 diff 选项要插在子命令**之后**（放到前面会报未知选项）。
 */
export const runDiff = (cwd: string, args: readonly string[]): Promise<GitRunResult> => {
  const [command = "diff", ...rest] = args;
  return runGit(cwd, [command, ...DIFF_ARGS, ...rest]);
};

/** 存在 `.git` 的目录即视为仓库根；worktree / submodule 的 `.git` 是文件，同样命中 */
const hasGitDir = (dir: string): boolean => {
  try {
    const stats = statSync(join(dir, ".git"), { throwIfNoEntry: false });
    return Boolean(stats);
  } catch {
    return false;
  }
};

/**
 * 从 `start` 向上找仓库根；找不到返回 null（调用方据此给 `isRepo: false` 而不是报错）。
 * 与权限规则 / 项目级资源用同一口径：看 `.git` 的存在性，不依赖 git 自身。
 */
export const findRepositoryRoot = (start: string): string | null => {
  let current = resolve(start);
  while (true) {
    if (hasGitDir(current)) return current;
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
};

/** 提交 hash：只接受十六进制（可与 `~` / `^` 之类的祖先引用叠加，但禁止 `-` 开头的选项） */
const HASH_PATTERN = /^[0-9a-fA-F]{4,40}(?:[~^][0-9]*)*$/;

/** 校验提交引用：既是防注入，也让 `git` 不会把参数当成选项 */
export const assertGitRef = (hash: string): string => {
  const trimmed = hash.trim();
  if (!HASH_PATTERN.test(trimmed)) {
    throw new AppError(ERROR_CODES.invalidRequest, `不是合法的提交引用：${hash}`, 400, undefined, {
      hash,
    });
  }
  return trimmed;
};

/**
 * 把仓库内的相对路径收敛成可安全拼进命令的形态：纯词法归一（`..` 折叠后仍需落在仓库内），
 * 不要求文件真实存在——「已删除」的条目也要能看 diff；拼到命令里时始终位于 `--` 之后，
 * git 只会把它当 pathspec。返回相对仓库根的 POSIX 路径，与 `git status` 的输出同口径。
 */
export const resolveRepoPath = (repoRoot: string, file: string): string => {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolute(normalized) || normalized === "") {
    throw new AppError(ERROR_CODES.invalidRequest, `不是仓库内路径：${file}`, 400, undefined, {
      path: file,
    });
  }
  const result = relative(repoRoot, resolve(repoRoot, normalized)).replaceAll("\\", "/");
  if (result === "" || result === ".." || result.startsWith("../")) {
    throw new AppError(ERROR_CODES.invalidRequest, `路径超出仓库范围：${file}`, 400, undefined, {
      path: file,
    });
  }
  return result;
};

/**
 * 文件是否已被跟踪（在 index 里有条目）。
 * 用来区分「未跟踪的新文件」与「已跟踪但没有工作区改动」：前者要看全文新增，后者就是没有差异。
 * 靠 `git ls-files --error-unmatch` 而不是「diff 为空 + 文件存在」推断——那个推断在工作区被提交 /
 * 还原之后会给出错误结论。
 */
export const isTracked = async (repoRoot: string, file: string): Promise<boolean> => {
  const result = await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", file]);
  return result.code === 0;
};

/** 目录必须存在且是仓库（含向上查找）；返回仓库根 */
export const requireRepositoryRoot = (path: string): string => {
  const dir = resolveExistingPath(path);
  const root = findRepositoryRoot(dir);
  if (!root) {
    throw new AppError(ERROR_CODES.notARepository, `目录不在 git 仓库内：${dir}`, 400, undefined, {
      path: dir,
    });
  }
  return root;
};

/** 供调用方判断目标目录是否在仓库内（不抛错） */
export const repositoryRootOf = (path: string): string | null => {
  if (!existsSync(resolve(path))) return null;
  return findRepositoryRoot(path);
};
