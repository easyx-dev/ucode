/**
 * 一个文件 diff 的全部输入：结构化 hunk、对比两侧原文、shiki 高亮适配器。
 *
 * 单文件标签与「全部改动」堆叠里的每一块都走它——堆叠视图里几十个块各自取数、各自就绪，
 * 不会等最慢的那个。高亮是增强：适配器没备好先给 null，渲染层据此铺纯文本。
 */
import type { GitContentsResponse, GitDiffResponse } from "@ucode/contracts";
import { useEffect, useState } from "react";
import type { AsyncData } from "../../../hooks/use-async-data";
import type { DiffShikiHighlighter } from "../../markdown/code/shiki-diff";
import { languageOfPath } from "../../markdown/code/shiki-languages";
import { type GitDiffTarget, useGitContents, useGitDiff } from "../use-workbench-data";

export type FileDiff = {
  /** 结构化 diff 的取数状态 */
  diff: AsyncData<GitDiffResponse>;
  /** 两侧原文；缺了就展不开未变更区域 */
  contents: GitContentsResponse | null | undefined;
  /** 语言就绪后的高亮适配器 */
  highlighter: DiffShikiHighlighter | null;
};

export function useFileDiff(target: GitDiffTarget, reloadToken = 0): FileDiff {
  const diff = useGitDiff(target, reloadToken);
  const contents = useGitContents(target, reloadToken);
  const [highlighter, setHighlighter] = useState<DiffShikiHighlighter | null>(null);
  const language = languageOfPath(target.file);

  // 语言就绪前先铺纯文本：库的 `getAST` 是同步的，拿到 null 会自己退回纯文本
  useEffect(() => {
    let cancelled = false;
    setHighlighter(null);
    void createHighlighter(language).then((adapter) => {
      if (!cancelled) setHighlighter(adapter);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return { diff, contents: contents.data, highlighter };
}

// 动态导入：不打开 diff 就不下载 shiki（核心 + 引擎 + 语言各成 chunk）
const createHighlighter = (language: string | null) =>
  import("../../markdown/code/shiki-diff").then(({ createDiffHighlighter }) =>
    createDiffHighlighter(language),
  );
