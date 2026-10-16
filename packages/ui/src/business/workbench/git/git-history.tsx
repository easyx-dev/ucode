/** 提交历史：列表（自带分页取数）与单次提交详情（元信息 + 各文件的 diff 堆叠） */
import type { GitCommitSummary } from "@ucode/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DiffDisplayControls } from "../../../base/diff-controls";
import { Spinner } from "../../../base/spinner";
import { useDiffPreferences } from "../../../hooks/use-diff-prefs";
import { relativeTimeLabel } from "../../../utils/time";
import { useGitCommit, useGitLog } from "../use-workbench-data";
import { DiffStack, type DiffStackItem } from "./diff-stack";
import { GitCounts } from "./git-change-marks";
import { GitCommitList } from "./git-commit-list";

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
    return <p className="px-3 py-3 text-xs text-foreground-subtle">{error.message}</p>;
  }
  if (loading && !data) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="text-foreground-subtle" />
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

/** 单次提交：元信息 + 该提交各文件的 diff，用与「全部改动」同一套堆叠卡片 */
export function CommitDetail({
  path,
  commit,
  reloadToken,
}: {
  path: string;
  commit: GitCommitSummary;
  reloadToken: number;
}) {
  const { t } = useTranslation();
  const { data, error, loading } = useGitCommit(path, commit.hash, reloadToken);
  const detail = data?.commit;
  const { mode, wrap, selectMode, toggleWrap } = useDiffPreferences();

  const files = data?.files ?? [];
  const items: DiffStackItem[] = useMemo(
    () =>
      files.map((file) => ({
        file: file.path,
        mark: file.status,
        additions: file.additions,
        deletions: file.deletions,
        target: { path, file: file.path, source: "commit", commit: commit.hash },
      })),
    [commit.hash, files, path],
  );
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => ({
          additions: sum.additions + (file.additions ?? 0),
          deletions: sum.deletions + (file.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="shrink-0 font-mono text-xs text-foreground-subtle">
          {commit.shortHash}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs" title={detail?.subject ?? commit.subject}>
          {detail?.subject || commit.subject || t("（无标题）")}
        </span>
        <GitCounts additions={totals.additions} deletions={totals.deletions} />
        <DiffDisplayControls
          mode={mode}
          wrap={wrap}
          onSelectMode={selectMode}
          onToggleWrap={toggleWrap}
        />
      </div>

      <p className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-foreground-subtle">
        <span className="truncate">{commit.authorName}</span>
        <span className="shrink-0">{relativeTimeLabel(commit.authoredAt)}</span>
      </p>

      {detail?.body ? (
        <pre className="max-h-32 shrink-0 overflow-auto border-b border-border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground-subtle">
          {detail.body}
        </pre>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 [&>div:first-child]:pt-2">
        {loading && !data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-foreground-subtle" />
          </div>
        ) : error ? (
          <p className="px-1 py-2 text-xs text-foreground-subtle">{error.message}</p>
        ) : items.length === 0 ? (
          <p className="px-1 py-2 text-xs text-foreground-subtle">{t("这个提交没有改动文件")}</p>
        ) : (
          <DiffStack items={items} mode={mode} wrap={wrap} reloadToken={reloadToken} />
        )}
        {data?.truncated ? (
          <p className="px-1 py-2 text-xs text-foreground-subtle">
            {t("变更过多，仅列出前一部分")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
