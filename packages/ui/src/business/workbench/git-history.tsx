/** 提交历史：列表（自带分页取数）与单次提交详情（元信息 + 改动文件） */
import type { GitCommitSummary } from "@ucode/contracts";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Spinner } from "../../base/spinner";
import { useGitCommit, useGitLog } from "../../hooks/use-workbench-data";
import { relativeTimeLabel } from "../../lib/time";
import { GitCommitList } from "./git-commit-list";
import { GitCounts, GitStatusMark } from "./git-marks";

/** 一次拉取的提交条数；「加载更多」按这个步长翻页 */
const PAGE_SIZE = 30;

export function CommitHistory({
  path,
  reloadToken,
  onSelect,
}: {
  path: string;
  reloadToken: number;
  onSelect: (commit: GitCommitSummary) => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { data, error, loading } = useGitLog(path, limit, 0, reloadToken);

  if (error) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">{error.message}</p>;
  }
  if (loading && !data) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <GitCommitList
      commits={data?.commits ?? []}
      hasMore={data?.hasMore ?? false}
      loading={loading}
      onLoadMore={() => setLimit((current) => current + PAGE_SIZE)}
      onSelect={onSelect}
    />
  );
}

/** 单次提交：元信息 + 改动文件列表；点文件交给上层切到 diff */
export function CommitDetail({
  path,
  commit,
  reloadToken,
  onSelectFile,
  onBack,
}: {
  path: string;
  commit: GitCommitSummary;
  reloadToken: number;
  onSelectFile: (file: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, error, loading } = useGitCommit(path, commit.hash, reloadToken);
  const detail = data?.commit;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 size-6 shrink-0"
          title={t("返回提交列表")}
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-foreground" title={detail?.subject ?? commit.subject}>
            {detail?.subject || commit.subject || t("（无标题）")}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{commit.shortHash}</span>
            <span className="truncate">{commit.authorName}</span>
            <span className="shrink-0">{relativeTimeLabel(commit.authoredAt)}</span>
          </p>
        </div>
      </div>

      {detail?.body ? (
        <pre className="max-h-32 shrink-0 overflow-auto border-b border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {detail.body}
        </pre>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {loading && !data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{error.message}</p>
        ) : (data?.files.length ?? 0) === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("这个提交没有改动文件")}</p>
        ) : (
          data?.files.map((file) => (
            <button
              key={file.path}
              type="button"
              className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-muted/60"
              onClick={() => onSelectFile(file.path)}
            >
              <GitStatusMark status={file.status} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {file.path}
              </span>
              <GitCounts additions={file.additions} deletions={file.deletions} />
            </button>
          ))
        )}
        {data?.truncated ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("变更过多，仅列出前一部分")}</p>
        ) : null}
      </div>
    </div>
  );
}
