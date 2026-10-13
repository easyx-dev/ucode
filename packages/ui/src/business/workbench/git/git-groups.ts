/**
 * 变更分组：已暂存与未暂存两组。
 *
 * 未跟踪与冲突都归进未暂存——它们都还没进 index，靠标记区分即可；分组多了反而要用户在
 * 四段列表里来回找。顺序沿用 `git status` 的习惯，已暂存在上。合并后按路径重排：
 * 三个桶各自有序，拼起来不是。
 */
import type { GitStatusResponse } from "@ucode/contracts";

import { entryOf, type GitChangeEntry } from "./git-marks";

export type GitChangeGroup = {
  id: "staged" | "unstaged";
  /** 该组的 diff 取 index 侧还是工作区侧 */
  staged: boolean;
  entries: GitChangeEntry[];
};

export const groupChanges = (status: GitStatusResponse): GitChangeGroup[] => {
  const groups: GitChangeGroup[] = [
    {
      id: "staged",
      staged: true,
      entries: status.staged.map((file) => entryOf(file, "staged")),
    },
    {
      id: "unstaged",
      staged: false,
      entries: [
        ...status.unstaged.map((file) => entryOf(file, "unstaged")),
        ...status.untracked.map((file) => entryOf(file, "untracked")),
        ...status.conflicted.map((file) => entryOf(file, "conflicted")),
      ].sort((a, b) => a.path.localeCompare(b.path)),
    },
  ];
  return groups.filter((group) => group.entries.length > 0);
};

/** 全部变更的增删合计：侧栏与堆叠视图的工具条上都用这一个口径（未跟踪没有行数，算 0） */
export const countChanges = (
  entries: readonly GitChangeEntry[],
): { additions: number; deletions: number } =>
  entries.reduce(
    (sum, entry) => ({
      additions: sum.additions + (entry.file.additions ?? 0),
      deletions: sum.deletions + (entry.file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
