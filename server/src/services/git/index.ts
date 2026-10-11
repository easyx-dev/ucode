/**
 * git 调用底座：固定参数白名单执行 git、向上找仓库根、把 repo 内相对路径收敛成安全入参。
 *
 * pi SDK 不提供任何 git API，这里直接用系统 git（不走 libgit2 之类的重实现，免得与用户的 git
 * 配置 / hook / 性能行为不一致）。所有命令都显式禁用外部 diff / textconv
 * 与分页，并强制 `core.quotepath=false`，避免 `.gitattributes` 触发外部程序、或非 ASCII 路径被转义。
 * 用户可控入参只有「仓库内相对路径」与「提交 hash」，两者都在这里校验后才拼进命令。
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";
import { execa } from "execa";

import { GIT_MAX_BUFFER, GIT_TIMEOUT_MS } from "../../constants/tools";
import { resolveExistingPath } from "../../platform/paths";
import { AppError } from "../../platform/response";

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
 * 执行失败（区别于「非零退出码」）的分类：找不到 git、输出超限、超时与其它失败分开报，便于界面给可读提示。
 * execa 的失败结果本身就是 Error（spawn 失败带 `code`、超限带 `isMaxBuffer`、超时带 `timedOut`），
 * 所以这里直接吃 result / error——另拼一个普通对象喂进来，`String()` 只会得到 `[object Object]`。
 */
const executionFailureOf = (error: unknown): AppError => {
  const failure = error as {
    code?: unknown;
    isMaxBuffer?: unknown;
    timedOut?: unknown;
    stderr?: unknown;
  } | null;

  if (failure?.code === "ENOENT") {
    return new AppError(ERROR_CODES.gitUnavailable, "未找到 git 可执行文件", 500, undefined);
  }
  if (failure?.isMaxBuffer === true) {
    return new AppError(
      ERROR_CODES.gitFailed,
      `git 输出超过 ${GIT_MAX_BUFFER} 字节上限`,
      500,
      undefined,
    );
  }
  if (failure?.timedOut === true) {
    return new AppError(
      ERROR_CODES.gitFailed,
      `git 执行超时：超过 ${GIT_TIMEOUT_MS}ms`,
      500,
      undefined,
    );
  }
  const stderr = failure?.stderr;
  const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : String(error);
  return new AppError(ERROR_CODES.gitFailed, `git 执行失败：${detail}`, 500, undefined);
};

/**
 * 执行一条白名单内的 git 子命令。`args` 由调用方给出，**不得**包含用户输入
 * （用户可控部分只能用 `--` 之后的位置参数，见 `runGitOnPaths`）。
 */
export const runGit = async (cwd: string, args: readonly string[]): Promise<GitRunResult> => {
  const result = await execa("git", [...GLOBAL_ARGS, ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    // 非零退出码是常态（diff / show 以 1 表示「有差异」），由调用方判断。
    // 注意 `reject: false` 放过的**不只是**非零退出码：spawn 失败与输出超限同样落成 result，见下面的判定
    reject: false,
    // 解析按行读，不依赖结尾换行，但也不必让库改掉原始输出
    stripFinalNewline: false,
  }).catch((error: unknown) => {
    // 兜住 execa 仍然 reject 的场合（参数非法等）；常规失败都在 result 上
    throw executionFailureOf(error);
  });

  // 下面四种都不是「正常退出」，不能当成「无差异」或成功：
  // 找不到 git 时 exitCode 为 undefined，且此时整个进程都没跑起来
  if (result.code === "ENOENT") throw executionFailureOf(result);
  // 输出超限时 exitCode 是 0、stdout 已被截断：不拦下来，调用方会把半截输出当成功解析
  if (result.isMaxBuffer) throw executionFailureOf(result);
  if (result.timedOut) throw executionFailureOf(result);
  // 被信号终止（非超时，如 OOM）没有退出码
  if (result.exitCode === undefined) throw executionFailureOf(result);

  return { stdout: result.stdout, code: result.exitCode };
};

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
