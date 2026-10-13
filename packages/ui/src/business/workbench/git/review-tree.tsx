/**
 * 代码管理视图的侧栏：改动 / 历史 切换 + 变更树（或提交列表）。
 *
 * 变更树点文件即打开该文件的 diff 标签，历史点一条即打开提交详情标签——两者都落在编辑器区，
 * 侧栏只负责列出来，所以这里不持选中态。
 */
import { GitBranch, Layers, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../base/button";
import { SegmentedControl } from "../../../base/segmented-control";
import { Spinner } from "../../../base/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../base/tooltip";
import { useWorkbench } from "../../../provider/workbench";
import { PanelEmpty } from "../panel-empty";
import { GitCounts } from "./git-change-marks";
import { GitChangeTree } from "./git-change-tree";
import { countChanges, groupChanges } from "./git-groups";
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
  // 变更合计：与堆叠视图同一口径（未跟踪没有行数，算 0）
  const totals = useMemo(
    () =>
      countChanges(
        (status.data ? groupChanges(status.data) : []).flatMap((group) => group.entries),
      ),
    [status.data],
  );

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
        {review.view === "changes" && status.data?.isRepo ? (
          // 侧栏拖窄时先让出合计的位置（分段控件与图标都不应被压缩）
          <span className="hidden min-w-0 shrink @[14rem]:flex">
            <GitCounts additions={totals.additions} deletions={totals.deletions} />
          </span>
        ) : null}
        <span className="ml-auto" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              title={t("堆叠查看全部改动")}
              onClick={() => workbench?.openChanges()}
            >
              <Layers className="size-icon-sm" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("堆叠查看全部改动")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              title={t("刷新")}
              onClick={review.reload}
            >
              <RefreshCw className="size-icon-sm" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("刷新")}</TooltipContent>
        </Tooltip>
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
          <PanelEmpty
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
