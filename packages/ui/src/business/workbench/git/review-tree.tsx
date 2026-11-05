/**
 * 代码管理视图的侧栏：改动 / 历史 切换 + 变更树（或提交列表）。
 *
 * 变更树点文件即打开该文件的 diff 标签，历史点一条即打开提交详情标签——两者都落在编辑器区，
 * 侧栏只负责列出来，所以这里不持选中态。
 */
import { GitBranch, Layers, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { SegmentedControl } from "../../../base/segmented-control";
import { Spinner } from "../../../base/spinner";
import { useWorkbench } from "../../../provider/workbench";
import { GitChangeTree } from "./git-change-tree";
import { CommitHistory } from "./git-history";
import type { GitReview } from "./use-git-review";

export function ReviewTree({
  review,
  cwd,
}: {
  review: GitReview;
  /** 会话工作目录；服务端据此自行定位仓库根 */
  cwd: string;
}) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const status = review.status;
  // 只有在仓库内才有分支名；分离头指针时是空串，没有提交时整项缺省（不显示标签）
  const branch = status.data?.isRepo ? status.data.branch : undefined;

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col">
      {/* 与文件树的头部同高（36px）：切视图时列表不会跳 */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-2">
        <SegmentedControl
          label={t("查看内容")}
          value={review.view}
          options={[
            { value: "changes", label: t("改动") },
            { value: "history", label: t("历史") },
          ]}
          onChange={review.selectView}
        />
        {review.view === "changes" && branch !== undefined ? (
          // 侧栏拖窄时先让出分支名的位置（分段控件与图标都不应被压缩）
          <span className="hidden min-w-0 shrink items-center gap-1 text-xs text-foreground-subtle @[14rem]:flex">
            <GitBranch className="size-icon-sm shrink-0" />
            <span className="truncate">{branch || t("分离头指针")}</span>
          </span>
        ) : null}
        <span className="ml-auto" />
        <IconButton
          label={t("堆叠查看全部改动")}
          size="icon-xs"
          onClick={() => workbench?.openChanges()}
        >
          <Layers className="size-icon-sm" />
        </IconButton>
        <IconButton label={t("刷新")} size="icon-xs" onClick={review.reload}>
          <RefreshCw className="size-icon-sm" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {review.view === "history" ? (
          <CommitHistory
            path={cwd}
            reloadToken={review.reloadToken}
            onSelect={(commit) => workbench?.openCommit(commit)}
          />
        ) : status.loading && !status.data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-foreground-subtle" />
          </div>
        ) : status.error ? (
          <p className="px-3 py-3 text-xs text-foreground-subtle">{status.error.message}</p>
        ) : !status.data ? null : !status.data.isRepo ? (
          <Empty
            className="h-full"
            icon={<GitBranch className="size-7" />}
            title={t("当前目录不在 git 仓库内，没有可查看的改动")}
            action={
              <Button variant="outline" size="sm" onClick={() => workbench?.selectView("files")}>
                {t("看项目文件")}
              </Button>
            }
          />
        ) : (
          <GitChangeTree
            status={status.data}
            onSelect={({ file, staged }) => workbench?.openChange({ file, staged })}
          />
        )}
      </div>
    </div>
  );
}
