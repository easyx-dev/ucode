/**
 * 仓库状态：分支与领先 / 落后、分组的变更条目与逐文件增删行数。
 *
 * 条目本身的解析在 `changes.ts`（与子模块共用同一套），子模块内的改动与指针变更由
 * `submodules.ts` 并进来；这里只负责主仓库这一圈信息与条数上限。
 */
import type { GitFileChange, GitStatusResponse } from "@ucode/contracts";

import { GIT_STATUS_MAX_FILES } from "../../constants/tools";
import { logger } from "../../platform/logger";
import { type GitRunResult, runGit } from "./";
import { readChanges } from "./changes";
import { mergeSubmoduleChanges } from "./submodules";

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

/**
 * 分支名收敛成契约口径：分离头指针时 `rev-parse` 报的是 `HEAD`，按契约给空串；
 * 仓库还没有提交时 HEAD 不存在、命令非零退出，整项缺省——界面据此区分这两种情形。
 */
const branchNameOf = (result: GitRunResult): string | undefined => {
  if (result.code !== 0) return undefined;
  const branch = result.stdout.trim();
  return branch === "HEAD" ? "" : branch || undefined;
};

export const readRepositoryStatus = async (repoRoot: string): Promise<GitStatusResponse> => {
  const [branchResult, buckets, upstream] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    readChanges(repoRoot),
    readUpstream(repoRoot),
  ]);

  // 子模块解析失败不该让整张列表不可用：拿不到就退回主仓库自己的条目
  let merged = buckets;
  try {
    merged = await mergeSubmoduleChanges(repoRoot, buckets);
  } catch (error) {
    logger.debug(`解析子模块变更失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const branch = branchNameOf(branchResult);
  const total =
    merged.staged.length +
    merged.unstaged.length +
    merged.untracked.length +
    merged.conflicted.length;
  const truncated = total > GIT_STATUS_MAX_FILES;
  const limit = (items: GitFileChange[]): GitFileChange[] => items.slice(0, GIT_STATUS_MAX_FILES);

  return {
    isRepo: true,
    repoRoot,
    ...(branch === undefined ? {} : { branch }),
    ...upstream,
    staged: limit(merged.staged),
    unstaged: limit(merged.unstaged),
    untracked: limit(merged.untracked),
    conflicted: limit(merged.conflicted),
    truncated,
  };
};
