/**
 * 单个文件的 diff 本体：把取来的 hunk 转成 patch 文本，连同两侧原文交给 `PatchDiff` 渲染。
 *
 * 单文件标签（`git-file-diff`）与「全部改动」堆叠（`diff-stack`）都用它——两者的差别只在头部，
 * 所以这里只管渲染 + 空态，取数交给 `useFileDiff`。
 */
import { FileWarning } from "lucide-react";
import { type Ref, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "../../../base/spinner";
import type { DiffMode } from "../../../hooks/use-diff-prefs";
import { PatchDiff, type PatchDiffRef } from "../../markdown/patch-diff";
import type { GitDiffTarget } from "../use-workbench-data";
import { hunkPatchText } from "./git-patch";
import type { FileDiff } from "./use-file-diff";

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
  diffRef?: Ref<PatchDiffRef>;
}) {
  const { t } = useTranslation();
  const { diff, contents } = fileDiff;
  const { file } = target;

  /** 库的入参：hunk 要「一整段 patch 文本」，两侧原文供它算未变更区域 */
  const patch = useMemo(
    () =>
      diff.data && !diff.data.binary && diff.data.hunks.length > 0
        ? hunkPatchText(file, diff.data.hunks)
        : "",
    [diff.data, file],
  );

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
  if (patch === "") {
    return <p className="px-1 py-2 text-xs text-foreground-subtle">{t("没有差异")}</p>;
  }

  return (
    // 窄容器下的适配（行号列收成一列）按 `.diff-scope` 这一层做容器查询，见 `styles/third-party.css`
    <div className="diff-scope">
      <PatchDiff
        data={{
          fileName: file,
          oldContent: contents?.old?.text ?? "",
          newContent: contents?.new?.text ?? "",
          patch,
        }}
        mode={mode}
        wrap={wrap}
        diffRef={diffRef}
      />
    </div>
  );
}
