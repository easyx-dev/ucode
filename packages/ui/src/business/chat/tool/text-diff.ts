/**
 * 行级 diff：把改前 / 改后文本折成带类型的行序列，供编辑与写入的差异展示使用。
 *
 * 比对交给 jsdiff（Myers 算法）；界面只认「新增 / 删除 / 未变」三态，故这里把它压成逐行的扁平序列，
 * 改动量过大时整块退化为「全删 + 全增」。
 */
import { diffLines as computeLineDiff } from "diff";

export type DiffLine = {
  /** 新增 / 删除 / 未变 */
  type: "add" | "del" | "ctx";
  /** 该行去掉行尾换行后的原文 */
  text: string;
};

/**
 * 允许的最大编辑距离，超过即整块替换。
 * 闸门取编辑距离而非文本规模：大文件里改几行仍能逐行展示，只有改动量本身大时才退化；
 * 耗时按 O(行数 × 编辑距离) 增长，行数一侧不必再设闸门（实测 30 万行的文本里改几百行仍在百毫秒量级）。
 */
const MAX_EDIT_LENGTH = 1000;

/**
 * 比对前统一补上末尾换行：行级 diff 表达不了「末行有没有换行」，不归一化的话 jsdiff 会把这种差异
 * 报成内容相同的「删一行 + 增一行」，界面上凭空多出一对红绿行。
 */
const ensureTrailingNewline = (text: string): string =>
  text === "" || text.endsWith("\n") ? text : `${text}\n`;

/** 折成行；文本通常以换行结尾，末尾空行不该多出一条 */
const toLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** 改动量大到不比了：整块当成「先全删、再全增」 */
const wholeReplacement = (oldText: string, newText: string): DiffLine[] => [
  ...toLines(oldText).map((text): DiffLine => ({ type: "del", text })),
  ...toLines(newText).map((text): DiffLine => ({ type: "add", text })),
];

export const diffLines = (oldText: string, newText: string): DiffLine[] => {
  const before = ensureTrailingNewline(oldText);
  const after = ensureTrailingNewline(newText);
  const changes = computeLineDiff(before, after, { maxEditLength: MAX_EDIT_LENGTH });
  if (!changes) return wholeReplacement(before, after);

  const lines: DiffLine[] = [];
  for (const change of changes) {
    const type: DiffLine["type"] = change.added ? "add" : change.removed ? "del" : "ctx";
    for (const text of toLines(change.value)) lines.push({ type, text });
  }
  return lines;
};
