/**
 * 一个文件 diff 的全部输入：结构化 hunk 与对比两侧原文。
 *
 * 单文件标签与「全部改动」堆叠里的每一块都走它——堆叠视图里几十个块各自取数、各自就绪，
 * 不会等最慢的那个。渲染与语法高亮交给 `markdown/patch-diff`。
 */
import type { GitContentsResponse, GitDiffResponse } from "@ucode/contracts";

import type { AsyncData } from "../../../hooks/use-async-data";
import { type GitDiffTarget, useGitContents, useGitDiff } from "../use-workbench-data";

export type FileDiff = {
  /** 结构化 diff 的取数状态 */
  diff: AsyncData<GitDiffResponse>;
  /** 两侧原文；缺了就展不开未变更区域 */
  contents: GitContentsResponse | null | undefined;
};

export function useFileDiff(target: GitDiffTarget, reloadToken = 0): FileDiff {
  const diff = useGitDiff(target, reloadToken);
  const contents = useGitContents(target, reloadToken);
  return { diff, contents: contents.data };
}
