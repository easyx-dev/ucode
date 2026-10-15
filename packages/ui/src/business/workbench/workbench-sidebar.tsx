/**
 * 侧栏：按活动栏选中的视图渲染项目文件树、代码管理（变更树 / 提交历史）或终端列表。
 *
 * 两个代码视图共用同一份仓库状态（`useGitReview` 在面板这一层持有）：文件树的 git 装饰与变更树来自
 * 同一次 status 请求，切视图不会各拉一遍。终端的进程清单由服务端持有（`useTerminals`），这里只管展示。
 * 没有工作目录时三个视图都给同一个占位。
 */
import { FileQuestionMark } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Empty } from "../../base/empty";
import { useWorkbench } from "../../provider/workbench";
import { FileTree } from "./file/file-tree";
import { buildGitMarks } from "./git/git-marks";
import { ReviewTree } from "./git/review-tree";
import type { GitReview } from "./git/use-git-review";
import { TerminalList } from "./terminal/terminal-list";

export function WorkbenchSidebar({
  review,
  /** 编辑器里正打开的普通文件；文件树据此高亮 */
  activeFile,
}: {
  review: GitReview;
  activeFile: string | null;
}) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const cwd = workbench?.cwd ?? null;
  const marks = useMemo(() => buildGitMarks(review.status.data ?? null), [review.status.data]);

  if (!workbench) return null;
  if (!cwd) {
    return (
      <Empty
        className="h-full"
        icon={<FileQuestionMark className="size-7" />}
        title={t("当前没有工作目录")}
      />
    );
  }

  return workbench.view === "files" ? (
    <FileTree root={cwd} activeFile={activeFile} marks={marks} />
  ) : workbench.view === "terminal" ? (
    <TerminalList />
  ) : (
    <ReviewTree review={review} cwd={cwd} />
  );
}
