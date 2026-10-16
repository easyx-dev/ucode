/**
 * 文本片段的 patch：`@git-diff-view/react` 的输入形态。
 *
 * 编辑器给出「改前 / 改后」两段文本，这里只负责比出 patch 与两侧原文——行号、未变区域的折叠、
 * 语法高亮都归库管（渲染见 `business/markdown/patch-diff.tsx`）。
 */
import { FILE_HEADERS_ONLY, formatPatch, structuredPatch } from "diff";

/** 一处改动的两侧文本 */
export type TextChange = { oldText: string; newText: string };

export type TextPatch = {
  /** 旧侧原文（多处改动按顺序拼接）：库用它铺未变更区域 */
  oldContent: string;
  /** 新侧原文（同上） */
  newContent: string;
  /** 一整段 patch 文本；两侧没有差异时为空串 */
  patch: string;
};

/**
 * 允许的最大编辑距离，超过即整块替换。
 * 闸门取编辑距离而非文本规模：大文件里改几行仍能逐行展示，只有改动量本身大时才退化；
 * 不设闸门时「整篇重写」（几千行全不同）会把主线程卡死（实测 2 万行要 44 秒）。
 */
const MAX_EDIT_LENGTH = 1000;

/** hunk 前后各留几行未变更的行 */
const CONTEXT = 3;

/**
 * 比对前统一补上末尾换行：行级 diff 表达不了「这段文本末尾有没有换行」，而片段末尾并不是文件末尾，
 * 贴一个「no newline at end of file」只会误导；两边只差末尾换行时也会凭空多出一对红绿行。
 */
const ensureTrailingNewline = (text: string): string =>
  text === "" || text.endsWith("\n") ? text : `${text}\n`;

/** 折成行；文本以换行结尾，末尾空行不该多出一条 */
const toLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** 一侧的行数区间；该侧为空时从 0 行起（`@@ -0,0 +1,3 @@`），与 git 的写法一致 */
const range = (lines: readonly string[]): string =>
  lines.length === 0 ? "0,0" : `1,${lines.length}`;

/** 改动量大到不比了：整块当成「先全删、再全增」，patch 自己拼 */
const replacementPatch = (file: string, oldContent: string, newContent: string): string => {
  const before = toLines(oldContent);
  const after = toLines(newContent);
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${range(before)} +${range(after)} @@`,
    ...before.map((line) => `-${line}`),
    ...after.map((line) => `+${line}`),
    "",
  ].join("\n");
};

/**
 * 多处改动拼成一段文本再比对：片段之间以换行相接，比对结果里也就自然带着它们之间的上下文行，
 * 而不是几段互不相干的 diff 摞在一起。
 */
export const toTextPatch = (file: string, changes: readonly TextChange[]): TextPatch => {
  const oldContent = ensureTrailingNewline(changes.map((change) => change.oldText).join("\n"));
  const newContent = ensureTrailingNewline(changes.map((change) => change.newText).join("\n"));
  const patch = structuredPatch(
    `a/${file}`,
    `b/${file}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: CONTEXT, maxEditLength: MAX_EDIT_LENGTH },
  );

  // 比对放弃（编辑距离超限）：整块替换
  if (!patch)
    return { oldContent, newContent, patch: replacementPatch(file, oldContent, newContent) };

  return {
    oldContent,
    newContent,
    // 没有 hunk 就是两侧无差异：空串，界面据此不渲染（只带文件头的 patch 会渲染成一片空白）
    patch: patch.hunks.length > 0 ? formatPatch(patch, FILE_HEADERS_ONLY) : "",
  };
};
