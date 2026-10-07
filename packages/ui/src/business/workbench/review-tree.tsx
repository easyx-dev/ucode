/**
 * 改动标签的左列：改动 / 历史 切换 + 变更树（或提交列表）。
 *
 * 变更树把改动按目录折层，点文件即让右列显示该文件的改动前后 diff；
 * 历史视图列出提交，点一条让右列显示该提交的元信息与改动文件。
 */
import type { GitCommitSummary } from "@ucode/contracts";
import { GitBranch, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Spinner } from "../../base/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../base/tooltip";
import type { GitReview } from "../../hooks/use-git-review";
import { SegmentedControl } from "../segmented-control";
import { GitChangeTree } from "./git-change-tree";
import { CommitHistory } from "./git-history";

export function ReviewTree({
  review,
  cwd,
  onSelectCommit,
}: {
  review: GitReview;
  /** 会话工作目录；服务端据此自行定位仓库根 */
  cwd: string;
  onSelectCommit: (commit: GitCommitSummary) => void;
}) {
  const { t } = useTranslation();
  const status = review.status;

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5">
        <SegmentedControl
          label={t("查看内容")}
          value={review.view}
          options={[
            { value: "changes", label: t("改动") },
            { value: "history", label: t("历史") },
          ]}
          onChange={review.selectView}
        />
        <span className="ml-auto" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              title={t("刷新")}
              onClick={review.reload}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("刷新")}</TooltipContent>
        </Tooltip>
      </div>

      {review.view === "changes" ? (
        <p className="flex shrink-0 items-center gap-1.5 px-3 pb-1 text-[11px] text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate font-mono" title={status.data?.branch || undefined}>
            {status.data?.branch || t("（无分支）")}
          </span>
          {status.data?.upstream && (status.data.ahead || status.data.behind) ? (
            <span className="shrink-0">
              {status.data.ahead ? `↑${status.data.ahead}` : ""}
              {status.data.behind ? `↓${status.data.behind}` : ""}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {review.view === "history" ? (
          <CommitHistory path={cwd} reloadToken={review.reloadToken} onSelect={onSelectCommit} />
        ) : status.loading && !status.data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : status.error ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">{status.error.message}</p>
        ) : !status.data ? null : !status.data.isRepo ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t("当前目录不在 git 仓库内，没有可查看的改动")}
          </p>
        ) : (
          <GitChangeTree
            status={status.data}
            onSelect={({ file, staged }) => review.selectChange(file, staged)}
          />
        )}
      </div>
    </div>
  );
}
