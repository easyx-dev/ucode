/** 提交历史列表：倒序分页，点开看该提交的元信息与改动文件 */
import type { GitCommitSummary } from "@ucode/contracts";
import { GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../base/button";
import { Spinner } from "../../../base/spinner";
import { relativeTimeLabel } from "../../../utils/time";

export function GitCommitList({
  commits,
  hasMore,
  loading,
  onLoadMore,
  onSelect,
}: {
  commits: readonly GitCommitSummary[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onSelect: (commit: GitCommitSummary) => void;
}) {
  const { t } = useTranslation();

  if (commits.length === 0) {
    return <p className="px-3 py-4 text-xs text-foreground-subtle">{t("还没有提交")}</p>;
  }

  return (
    <div className="py-1">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          type="button"
          className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-state-hover"
          onClick={() => onSelect(commit)}
        >
          <GitCommitHorizontal className="mt-0.5 size-icon-sm shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground" title={commit.subject}>
              {commit.subject || t("（无标题）")}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground-subtle">
              <span className="font-mono">{commit.shortHash}</span>
              <span className="truncate">{commit.authorName}</span>
              <span className="shrink-0">{relativeTimeLabel(commit.authoredAt)}</span>
            </span>
            {commit.refs.length > 0 ? (
              <span className="mt-0.5 flex flex-wrap gap-1">
                {commit.refs.map((ref) => (
                  <span
                    key={ref}
                    className="rounded-sm bg-muted px-1 font-mono text-xs text-foreground-subtle"
                  >
                    {ref}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </button>
      ))}
      {hasMore ? (
        <div className="flex justify-center py-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading ? <Spinner /> : null}
            {t("加载更多")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
