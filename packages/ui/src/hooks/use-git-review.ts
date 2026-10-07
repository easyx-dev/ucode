/**
 * 改动标签的状态：视图（改动 / 历史）、选中项与刷新时机。
 *
 * 左列与右列是同一个分栏下的两个面板，选中项要跨这两个面板共享，因此抽成 hook，
 * 由面板容器持有、以 props 交给左右两半。刷新入口有三个：手动按钮、切回标签时、
 * 以及每轮对话结束（`agent_settled`）——agent 刚改过的文件要出现在变更树里，
 * 而服务端没有文件变更推送，只能用这个信号兜。
 */
import type { GitCommitSummary } from "@ucode/contracts";
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../provider";
import { useGitStatus } from "./use-workbench-data";

export type ReviewView = "changes" | "history";

/** 右列正在看的东西：某个工作区变更，或某次提交里的某个文件 */
export type ReviewSelection =
  | { kind: "change"; file: string; staged: boolean }
  | { kind: "commit"; hash: string; file: string };

export type GitReview = {
  view: ReviewView;
  selectView: (view: ReviewView) => void;
  /** 工作区变更与分支信息；左列的变更树用 */
  status: ReturnType<typeof useGitStatus>;
  reload: () => void;
  reloadToken: number;
  /** 右列正在看的文件（diff） */
  selection: ReviewSelection | null;
  /** 左列点开的提交（右列显示它的元信息与改动文件） */
  openedCommit: GitCommitSummary | null;
  selectChange: (file: string, staged: boolean) => void;
  selectCommitFile: (hash: string, file: string) => void;
  openCommit: (commit: GitCommitSummary) => void;
  /** 从提交详情退回提交列表 */
  closeCommit: () => void;
  /** 右列返回：清掉正在看的文件——提交视图回到提交详情，改动视图回到空态 */
  back: () => void;
};

export function useGitReview(path: string | null): GitReview {
  const client = useClient();
  const [view, setView] = useState<ReviewView>("changes");
  const [reloadToken, setReloadToken] = useState(0);
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [openedCommit, setOpenedCommit] = useState<GitCommitSummary | null>(null);

  useEffect(
    () =>
      client.events.onEvent((frame) => {
        if (frame.type === "agent_settled") setReloadToken((token) => token + 1);
      }),
    [client],
  );

  const status = useGitStatus(path, reloadToken);

  const selectView = useCallback((next: ReviewView) => {
    setView(next);
    // 换视图即放下之前的选择：diff 与提交详情都只属于原来的视图
    setSelection(null);
    setOpenedCommit(null);
  }, []);

  const selectChange = useCallback((file: string, staged: boolean) => {
    setOpenedCommit(null);
    setSelection({ kind: "change", file, staged });
  }, []);

  const selectCommitFile = useCallback((hash: string, file: string) => {
    setSelection({ kind: "commit", hash, file });
  }, []);

  const openCommit = useCallback((commit: GitCommitSummary) => {
    setSelection(null);
    setOpenedCommit(commit);
  }, []);

  const closeCommit = useCallback(() => setOpenedCommit(null), []);

  const back = useCallback(() => {
    // 从 diff 退回：提交里的文件退到提交详情（openedCommit 保留），工作区变更退回空态
    setSelection(null);
  }, []);

  return {
    view,
    selectView,
    status,
    reload: () => setReloadToken((token) => token + 1),
    reloadToken,
    selection,
    openedCommit,
    selectChange,
    selectCommitFile,
    openCommit,
    closeCommit,
    back,
  };
}
