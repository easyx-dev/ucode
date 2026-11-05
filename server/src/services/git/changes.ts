/**
 * 变更条目的解析与读取：把 `git status --porcelain=v1 -z` 与两侧的 `--numstat -z` 折成四个桶。
 *
 * 主仓库与子模块共用同一套解析（子模块的条目由调用方按主仓库相对路径加前缀），所以这里只认
 * 「一个仓库根」，不知道子模块的存在。
 *
 * `--numstat` 刻意带 `--no-renames`：重命名会被拆成「删旧 + 增新」两条，于是每条记录都只有
 * 「增 删 路径」三个 NUL 分隔字段，不必处理空路径 + 双路径的特例；代价是重命名条目拿不到行数，
 * 按契约给 null。
 */
import type { GitFileChange, GitFileStatus } from "@ucode/contracts";

import { logger } from "../../platform/logger";
import { runDiff, runGit } from "./";

type Counts = { additions: number | null; deletions: number | null };

export type ChangeBuckets = {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
};

const emptyBuckets = (): ChangeBuckets => ({
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
});

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
  const buckets = emptyBuckets();
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

/** 给条目路径加上子模块前缀；空前缀即主仓库，原样返回 */
const prefixBuckets = (buckets: ChangeBuckets, prefix: string): ChangeBuckets => {
  if (prefix === "") return buckets;
  const prefixed = (file: GitFileChange): GitFileChange => ({
    ...file,
    path: `${prefix}/${file.path}`,
    ...(file.oldPath === undefined ? {} : { oldPath: `${prefix}/${file.oldPath}` }),
  });
  return {
    staged: buckets.staged.map(prefixed),
    unstaged: buckets.unstaged.map(prefixed),
    untracked: buckets.untracked.map(prefixed),
    conflicted: buckets.conflicted.map(prefixed),
  };
};

/** 读一个仓库的四个桶；`prefix` 非空时给所有路径加上子模块前缀（子模块递归用） */
export const readChanges = async (root: string, prefix = ""): Promise<ChangeBuckets> => {
  const [statusResult, stagedCounts, unstagedCounts] = await Promise.all([
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    readCounts(root, ["diff", "--cached"]),
    readCounts(root, ["diff"]),
  ]);
  return prefixBuckets(parseChanges(statusResult.stdout, stagedCounts, unstagedCounts), prefix);
};
