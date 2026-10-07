/**
 * 仓库状态：分支与领先 / 落后、分组的变更条目与逐文件增删行数。
 *
 * 数据源是 `git status --porcelain=v1 -z`（比 v2 好解析，且路径不转义）与两侧的
 * `--numstat -z`。行数统计刻意带 `--no-renames`：重命名会被拆成「删旧 + 增新」两条，
 * 于是每条记录都只有「增 删 路径」三个 NUL 分隔字段，不必处理空路径 + 双路径的特例；
 * 代价是重命名条目拿不到行数，按契约给 null。
 */
import type { GitFileChange, GitFileStatus, GitStatusResponse } from "@ucode/contracts";

import { GIT_STATUS_MAX_FILES } from "../../constants";
import { logger } from "../logger";
import { runDiff, runGit } from "./index";

type Counts = { additions: number | null; deletions: number | null };

/** `--numstat -z` 的一条记录：`增\t删\t路径`，二进制时前两列为 `-` */
const parseNumstat = (stdout: string, into: Map<string, Counts>): void => {
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const additions = record.slice(0, first);
    const deletions = record.slice(first + 1, second);
    const path = record.slice(second + 1);
    into.set(path, {
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    });
  }
};

/** porcelain 的状态字符 → 契约里的状态；未覆盖的组合归为 modified */
const STATUS_BY_CHAR: Record<string, GitFileStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typeChanged",
};

/** 未合并（冲突）的 XY 组合；这些条目单独成组，不按「已暂存 / 未暂存」拆 */
const isConflicted = (x: string, y: string): boolean =>
  x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");

type ChangeBuckets = {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
};

const changeOf = (
  path: string,
  status: GitFileStatus,
  counts: Map<string, Counts> | null,
  oldPath?: string,
): GitFileChange => {
  const stat = counts?.get(path) ?? null;
  return {
    path,
    ...(oldPath ? { oldPath } : {}),
    status,
    additions: stat?.additions ?? null,
    deletions: stat?.deletions ?? null,
  };
};

/** 解析 porcelain 输出；`stagedCounts` / `unstagedCounts` 分别对应 X / Y 两侧的行数 */
const parseChanges = (
  stdout: string,
  stagedCounts: Map<string, Counts>,
  unstagedCounts: Map<string, Counts>,
): ChangeBuckets => {
  const buckets: ChangeBuckets = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  const records = stdout.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    // 末条为空串；`R` / `C` 条目的原路径是紧随其后的独立记录
    if (!record) continue;
    const x = record[0] ?? " ";
    const y = record[1] ?? " ";
    const path = record.slice(3);

    if (x === "?") {
      buckets.untracked.push(changeOf(path, "added", null));
      continue;
    }
    if (x === "!") continue;

    if (isConflicted(x, y)) {
      buckets.conflicted.push(changeOf(path, "conflicted", unstagedCounts));
      continue;
    }

    const renamed = x === "R" || x === "C";
    let oldPath: string | undefined;
    if (renamed) {
      index += 1;
      oldPath = records[index];
    }

    if (x !== " ") {
      buckets.staged.push(changeOf(path, STATUS_BY_CHAR[x] ?? "modified", stagedCounts, oldPath));
    }
    if (y !== " ") {
      buckets.unstaged.push(
        changeOf(path, STATUS_BY_CHAR[y] ?? "modified", unstagedCounts, oldPath),
      );
    }
  }

  return buckets;
};

/** 逐文件行数；失败（如仓库没有任何提交）不算错误，退化为「无统计」 */
const readCounts = async (cwd: string, args: readonly string[]): Promise<Map<string, Counts>> => {
  const counts = new Map<string, Counts>();
  try {
    const result = await runDiff(cwd, [...args, "--numstat", "--no-renames", "-z"]);
    parseNumstat(result.stdout, counts);
  } catch (error) {
    // 失败不影响列表可用，只少 +N/-M
    logger.debug(`统计 git 行数失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return counts;
};

/** 上游信息；没有上游或命令失败时全部缺省 */
const readUpstream = async (
  repoRoot: string,
): Promise<Pick<GitStatusResponse, "upstream" | "ahead" | "behind">> => {
  try {
    const upstream = (
      await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"])
    ).stdout.trim();
    if (!upstream) return {};
    // `HEAD...@{upstream}` 的左右计数分别是领先与落后
    const counts = (
      await runGit(repoRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
    ).stdout
      .trim()
      .split("\t");
    return {
      upstream,
      ahead: Number(counts[0] ?? 0),
      behind: Number(counts[1] ?? 0),
    };
  } catch {
    return {};
  }
};

export const readRepositoryStatus = async (repoRoot: string): Promise<GitStatusResponse> => {
  const [branchResult, statusResult, stagedCounts, unstagedCounts] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    readCounts(repoRoot, ["diff", "--cached"]),
    readCounts(repoRoot, ["diff"]),
  ]);

  // 空仓库（还没有任何提交）时 HEAD 不存在，`rev-parse` 以非零码退出，分支按空串报
  const branch = branchResult.stdout.trim();
  const buckets = parseChanges(statusResult.stdout, stagedCounts, unstagedCounts);

  const total =
    buckets.staged.length +
    buckets.unstaged.length +
    buckets.untracked.length +
    buckets.conflicted.length;
  const truncated = total > GIT_STATUS_MAX_FILES;
  const limit = (items: GitFileChange[]): GitFileChange[] => items.slice(0, GIT_STATUS_MAX_FILES);

  return {
    isRepo: true,
    repoRoot,
    branch,
    ...(await readUpstream(repoRoot)),
    staged: limit(buckets.staged),
    unstaged: limit(buckets.unstaged),
    untracked: limit(buckets.untracked),
    conflicted: limit(buckets.conflicted),
    truncated,
  };
};
