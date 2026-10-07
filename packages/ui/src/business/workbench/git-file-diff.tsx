/**
 * 单文件 diff：数据自己拉，头部给出路径 / 状态 / 增删，正文按 hunk 分段。
 *
 * hunk 之间的分隔沿用 git 的原始头（`@@ -a,b +c,d @@` 与函数上下文），不重排也不合并，
 * 这样与终端里 `git diff` 看到的是同一件事。
 */
import type { GitDiffResponse, GitDiffSource } from "@ucode/contracts";
import { cn } from "cn";
import { ChevronLeft, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Spinner } from "../../base/spinner";
import { useGitDiff } from "../../hooks/use-workbench-data";
import { type DiffRow, DiffView } from "../diff-view";
import { GitCounts, GitStatusMark } from "./git-marks";

const rowsOf = (diff: GitDiffResponse, index: number): DiffRow[] =>
  (diff.hunks[index]?.lines ?? []).map((line) => ({
    type: line.kind,
    text: line.text,
    oldLine: line.oldLine,
    newLine: line.newLine,
  }));

export function GitFileDiff({
  path,
  file,
  source,
  commit,
  reloadToken,
  onBack,
  /** 返回按钮的文案：改动视图回变更列表，提交视图回提交详情 */
  backLabel,
}: {
  path: string;
  file: string;
  source: GitDiffSource;
  commit?: string;
  reloadToken: number;
  onBack: () => void;
  backLabel: string;
}) {
  const { t } = useTranslation();
  const { data, error, loading } = useGitDiff({ path, file, source, commit }, reloadToken);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          title={backLabel}
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {data ? <GitStatusMark status={data.status} /> : null}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file}>
          {file}
          {data?.oldPath ? (
            <span className="text-muted-foreground">{` ← ${data.oldPath}`}</span>
          ) : null}
        </span>
        {data ? <GitCounts additions={data.additions} deletions={data.deletions} /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{error.message}</p>
        ) : data?.binary ? (
          <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <FileWarning className="size-3.5" />
            {t("二进制文件，git 不展开差异")}
          </p>
        ) : data && data.hunks.length > 0 ? (
          <div className="space-y-2">
            {data.hunks.map((hunk, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: hunk 按顺序排列，头部文本可能重复
              <div key={index}>
                <p className="truncate px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
                  {hunk.header}
                </p>
                <DiffView rows={rowsOf(data, index)} className="overflow-x-visible" />
              </div>
            ))}
          </div>
        ) : (
          <p className={cn("px-1 py-2 text-xs text-muted-foreground")}>{t("没有差异")}</p>
        )}
        {data?.truncated ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{t("差异过大，已按上限截断")}</p>
        ) : null}
      </div>
    </div>
  );
}
