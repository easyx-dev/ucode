/**
 * patch 文本的 diff 渲染：把 `@git-diff-view/react` 接上本项目的主题、字号与语法高亮。
 *
 * 工作台的 git 面板与消息流的改动卡片共用它——两边的输入都是「一段 patch + 两侧原文」，
 * 差别只在数据从哪来、给不给展示控件。文件名要传真实路径：库按扩展名推断语言，
 * 高亮适配器（`code/shiki-diff.ts`）靠这个语言找 shiki。高亮是增强，语言未就绪时先铺纯文本。
 */
import { type DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useTheme } from "next-themes";
import { type Ref, useEffect, useMemo, useState } from "react";

import type { DiffMode } from "../../hooks/use-diff-prefs";
import { useTokenNumber } from "../../hooks/use-token-number";
import type { DiffShikiHighlighter } from "./code/shiki-diff";
import { languageOfPath } from "./code/shiki-languages";

/** 库的命令式入口：工具条上的「全部展开 / 收起」要直接调实例方法 */
export type PatchDiffRef = { getDiffFileInstance: () => DiffFile | null };

export type PatchDiffData = {
  /** 真实文件名（含扩展名）：库按它推断语法高亮的语言 */
  fileName: string;
  /** 旧侧原文；没有（新建）时给空串 */
  oldContent: string;
  /** 新侧原文；没有（删除）时给空串 */
  newContent: string;
  /** 一整段 patch 文本（`---` / `+++` 与全部 hunk），空串不渲染 */
  patch: string;
};

/** diff 行字号跟随 text-xs 档（基准的 6/7）：库只吃数字字号，取不到基准时用 14px 推回的默认值 */
const CODE_SIZE_RATIO = 6 / 7;

export function PatchDiff({
  data,
  mode,
  wrap,
  diffRef,
}: {
  data: PatchDiffData;
  mode: DiffMode;
  /** 长行是否折行 */
  wrap: boolean;
  /** 调用方要给「全部展开 / 收起」时把 ref 传进来 */
  diffRef?: Ref<PatchDiffRef>;
}) {
  const { resolvedTheme } = useTheme();
  const fontSizeBase = useTokenNumber("--font-size-base", 14);
  const highlighter = useDiffHighlighter(languageOfPath(data.fileName));
  const { fileName, oldContent, newContent, patch } = data;

  // 按字段而不是按 `data` 的引用记忆：调用方每次重渲染新建一个数据对象时，库不会白白重建 diff
  const viewData = useMemo(
    () => ({
      // 库的 `hunks` 每项都会被当成一整段 diff 交给解析器（GitHub 的 unified diff parser）：
      // 整段拼好、只给一个元素，故这里永远只有一项
      oldFile: { fileName, content: oldContent },
      newFile: { fileName, content: newContent },
      hunks: [patch],
    }),
    [fileName, oldContent, newContent, patch],
  );

  return (
    <DiffView
      ref={diffRef}
      data={viewData}
      diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
      diffViewTheme={resolvedTheme === "light" ? "light" : "dark"}
      diffViewWrap={wrap}
      diffViewFontSize={Math.round(fontSizeBase * CODE_SIZE_RATIO)}
      registerHighlighter={highlighter ?? undefined}
      diffViewHighlight={highlighter !== null}
    />
  );
}

/** 语言就绪后的高亮适配器；不打开 diff 就不下载 shiki（核心 + 引擎 + 语言各成 chunk） */
function useDiffHighlighter(language: string | null): DiffShikiHighlighter | null {
  const [highlighter, setHighlighter] = useState<DiffShikiHighlighter | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHighlighter(null);
    void import("./code/shiki-diff")
      .then(({ createDiffHighlighter }) => createDiffHighlighter(language))
      .then((adapter) => {
        if (!cancelled) setHighlighter(adapter);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return highlighter;
}
