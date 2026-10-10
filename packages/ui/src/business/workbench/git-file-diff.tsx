/**
 * 单文件标签的 diff：文件头工具条（展示方式、换行、全部展开收起）+ `DiffViewer`。
 *
 * 取数与渲染都在 `use-file-diff` / `diff-viewer` 里，「全部改动」堆叠视图共用同一套；
 * 这里只补单文件独有的那条工具条。组件由外层用 `key={doc.id}` 挂载，切标签即重置折叠状态。
 */
import { FoldVertical, UnfoldVertical } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../base/tooltip";
import { useDiffPreferences } from "../../hooks/use-diff-prefs";
import { useFileDiff } from "../../hooks/use-file-diff";
import type { GitDiffTarget } from "../../hooks/use-workbench-data";
import { DiffDisplayControls } from "./diff-controls";
import { type DiffFileRef, DiffViewer } from "./diff-viewer";
import { GitCounts, GitStatusMark } from "./git-marks";

export function GitFileDiff({
  target,
  reloadToken,
}: {
  target: GitDiffTarget;
  reloadToken: number;
}) {
  const { t } = useTranslation();
  const fileDiff = useFileDiff(target, reloadToken);
  const data = fileDiff.diff.data;
  const { mode, wrap, selectMode, toggleWrap } = useDiffPreferences();
  const [allExpanded, setAllExpanded] = useState(false);
  const diffRef = useRef<DiffFileRef>(null);

  /** 全部展开 / 收起：直接调库的实例方法，状态以按钮自己的记忆为准 */
  const toggleAll = (): void => {
    const file = diffRef.current?.getDiffFileInstance();
    if (!file) return;
    const libraryMode = mode === "split" ? "split" : "unified";
    if (allExpanded) file.onAllCollapse(libraryMode);
    else file.onAllExpand(libraryMode);
    setAllExpanded((prev) => !prev);
  };

  const hasDiff = data != null && !data.binary && data.hunks.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        {data ? <GitStatusMark mark={data.status} /> : null}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={target.file}>
          {target.file}
          {data?.oldPath ? (
            <span className="text-muted-foreground">{` ← ${data.oldPath}`}</span>
          ) : null}
        </span>
        {data ? <GitCounts additions={data.additions} deletions={data.deletions} /> : null}

        {hasDiff ? (
          <>
            <DiffDisplayControls
              mode={mode}
              wrap={wrap}
              onSelectMode={selectMode}
              onToggleWrap={toggleWrap}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title={allExpanded ? t("全部收起") : t("全部展开")}
                  onClick={toggleAll}
                >
                  {allExpanded ? (
                    <FoldVertical className="size-4" />
                  ) : (
                    <UnfoldVertical className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{allExpanded ? t("全部收起") : t("全部展开")}</TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2">
        <DiffViewer target={target} fileDiff={fileDiff} mode={mode} wrap={wrap} diffRef={diffRef} />
      </div>

      {data?.truncated ? (
        <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t("差异过大，已按上限截断")}
        </p>
      ) : null}
    </div>
  );
}
