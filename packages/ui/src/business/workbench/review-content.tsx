/**
 * 改动标签的右列：按选中项显示改动前后 diff，或所选提交的元信息与文件列表。
 *
 * 什么都不选时给空态——左列是入口，右列是结果，两层都空说明用户还没点。
 */
import { PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GitReview } from "../../hooks/use-git-review";
import { GitFileDiff } from "./git-file-diff";
import { CommitDetail } from "./git-history";
import { PanelEmpty } from "./panel-empty";

export function ReviewContent({ review, cwd }: { review: GitReview; cwd: string }) {
  const { t } = useTranslation();

  if (review.selection?.kind === "change") {
    return (
      <GitFileDiff
        path={cwd}
        file={review.selection.file}
        source={review.selection.staged ? "staged" : "worktree"}
        reloadToken={review.reloadToken}
        onBack={review.back}
        backLabel={t("返回变更列表")}
      />
    );
  }

  if (review.selection?.kind === "commit") {
    return (
      <GitFileDiff
        path={cwd}
        file={review.selection.file}
        source="commit"
        commit={review.selection.hash}
        reloadToken={review.reloadToken}
        onBack={review.back}
        backLabel={t("返回提交详情")}
      />
    );
  }

  if (review.openedCommit) {
    return (
      <CommitDetail
        path={cwd}
        commit={review.openedCommit}
        reloadToken={review.reloadToken}
        onBack={review.closeCommit}
        onSelectFile={(file) => review.selectCommitFile(review.openedCommit?.hash ?? "", file)}
      />
    );
  }

  return (
    <PanelEmpty
      icon={<PanelRightOpen className="size-7" />}
      title={t("选择左侧的条目")}
      hint={t("改动看前后对比，历史看每次提交")}
    />
  );
}
