/**
 * git 侧栏视图的状态：改动 / 历史两个视图、仓库状态与刷新时机。
 *
 * 选中的变更与提交不在这里——它们现在是编辑器区的文档标签（`use-workbench-docs`），
 * 侧栏只负责「列出来」。刷新入口有三个：手动按钮、切回视图时、以及每轮对话结束（`agent_settled`）
 * ——agent 刚改过的文件要出现在变更列表里，而服务端没有文件变更推送，只能用这个信号兜。
 */
import { useCallback, useEffect, useState } from "react";

import { useClient } from "../../../provider";
import { useGitStatus } from "../use-workbench-data";

export type ReviewView = "changes" | "history";

export type GitReview = {
  view: ReviewView;
  selectView: (view: ReviewView) => void;
  /** 工作区变更与分支信息；变更树与文件树装饰都用它 */
  status: ReturnType<typeof useGitStatus>;
  reload: () => void;
  reloadToken: number;
};

export function useGitReview(path: string | null): GitReview {
  const client = useClient();
  const [view, setView] = useState<ReviewView>("changes");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(
    () =>
      client.events.onEvent((frame) => {
        if (frame.type === "agent_settled") setReloadToken((token) => token + 1);
      }),
    [client],
  );

  const selectView = useCallback((next: ReviewView) => setView(next), []);

  return {
    view,
    selectView,
    status: useGitStatus(path, reloadToken),
    reload: () => setReloadToken((token) => token + 1),
    reloadToken,
  };
}
