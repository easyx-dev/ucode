/**
 * 单个文件的 diff 本体：把取来的 hunk 与两侧原文交给 `@git-diff-view/react` 渲染。
 *
 * 单文件标签（`git-file-diff`）与「全部改动」堆叠（`changes-stack`）都用它——两者的差别只在头部，
 * 所以这里只管渲染 + 空态，取数交给 `useFileDiff`。
 */
import { type DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import { FileWarning } from "lucide-react";
import { useTheme } from "next-themes";
import { type Ref, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "../../base/spinner";
import type { FileDiff } from "../../hooks/use-file-diff";
import { useTokenNumber } from "../../hooks/use-token-number";
import type { GitDiffTarget } from "../../hooks/use-workbench-data";
import type { DiffMode } from "../../lib/diff-prefs";
import { hunkPatchText } from "../../lib/git-patch";

/** 库的命令式入口：工具条上的「全部展开 / 收起」要直接调实例方法 */
export type DiffFileRef = { getDiffFileInstance: () => DiffFile | null };

/** diff 行字号跟随 text-xs 档（基准的 6/7）：库只吃数字字号，取不到基准时用 14px 推回的默认值 */
const CODE_SIZE_RATIO = 6 / 7;

export function DiffViewer({
  target,
  fileDiff,
  mode,
  wrap,
  diffRef,
}: {
  target: GitDiffTarget;
  fileDiff: FileDiff;
  mode: DiffMode;
  wrap: boolean;
  /** 「全部展开 / 收起」要用库的实例方法，单文件视图把 ref 传进来 */
  diffRef?: Ref<DiffFileRef>;
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const fontSizeBase = useTokenNumber("--font-size-base", 14);
  const { diff, contents, highlighter } = fileDiff;

  /** 库的入参：hunk 要「一整段 patch 文本」，两侧原文供它算未变更区域 */
  const diffData = useMemo(() => {
    const data = diff.data;
    if (!data || data.binary || data.hunks.length === 0) return null;
    return {
      oldFile: {
        fileName: target.file,
        content: contents?.old?.text ?? null,
      },
      newFile: {
        fileName: target.file,
        content: contents?.new?.text ?? null,
      },
      hunks: [hunkPatchText(target.file, data.hunks)],
    };
  }, [contents, diff.data, target.file]);

  if (diff.loading && !diff.data) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="text-foreground-subtle" />
      </div>
    );
  }
  if (diff.error) {
    return <p className="px-1 py-2 text-xs text-foreground-subtle">{diff.error.message}</p>;
  }
  if (!diff.data) return null;
  if (diff.data.binary) {
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-xs text-foreground-subtle">
        <FileWarning className="size-icon-sm" />
        {t("二进制文件，git 不展开差异")}
      </p>
    );
  }
  if (!diffData) {
    return <p className="px-1 py-2 text-xs text-foreground-subtle">{t("没有差异")}</p>;
  }

  return (
    <DiffView
      ref={diffRef}
      data={diffData}
      diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
      diffViewTheme={resolvedTheme === "light" ? "light" : "dark"}
      diffViewWrap={wrap}
      diffViewFontSize={Math.round(fontSizeBase * CODE_SIZE_RATIO)}
      registerHighlighter={highlighter ?? undefined}
      diffViewHighlight={highlighter !== null}
    />
  );
}
