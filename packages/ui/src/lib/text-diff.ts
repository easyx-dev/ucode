/**
 * 行级 diff：把改前 / 改后文本折成带类型的行序列，供编辑与写入的差异展示使用。
 * 纯函数、不依赖 React；规模过大时退化为「全删 + 全增」，避免 LCS 表撑爆内存。
 */
export type DiffLine = {
  /** 新增 / 删除 / 未变 */
  type: "add" | "del" | "ctx";
  /** 该行去掉行尾换行后的原文 */
  text: string;
};

/** LCS 单元格上限；超过后不再逐行比对，直接全删全增 */
const MAX_CELLS = 250_000;

const toLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  // 文本通常以换行结尾，去掉末尾空行以免 diff 多出一条空行
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const sameLines = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((line, index) => line === right[index]);

export const diffLines = (oldText: string, newText: string): DiffLine[] => {
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  if (sameLines(oldLines, newLines)) return oldLines.map((text) => ({ type: "ctx", text }));

  if (oldLines.length * newLines.length > MAX_CELLS) {
    return [
      ...oldLines.map((text): DiffLine => ({ type: "del", text })),
      ...newLines.map((text): DiffLine => ({ type: "add", text })),
    ];
  }

  // 扁平 LCS 长度表：dp[i][j] 表示 oldLines[i..] 与 newLines[j..] 的最长公共子序列长度
  const rows = oldLines.length;
  const cols = newLines.length;
  const stride = cols + 1;
  const dp = new Array<number>((rows + 1) * stride).fill(0);
  const get = (i: number, j: number): number => dp[i * stride + j] ?? 0;

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      dp[i * stride + j] =
        oldLines[i] === newLines[j]
          ? get(i + 1, j + 1) + 1
          : Math.max(get(i + 1, j), get(i, j + 1));
    }
  }

  // 从右下角回溯，公共子序列即未变行
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "ctx", text: oldLines[i] ?? "" });
      i += 1;
      j += 1;
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      result.push({ type: "del", text: oldLines[i] ?? "" });
      i += 1;
    } else {
      result.push({ type: "add", text: newLines[j] ?? "" });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ type: "del", text: oldLines[i] ?? "" });
    i += 1;
  }
  while (j < cols) {
    result.push({ type: "add", text: newLines[j] ?? "" });
    j += 1;
  }
  return result;
};
