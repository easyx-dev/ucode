/**
 * 容器围栏：`:::command[名字]` / `:::skill[名字]` 到等长或更长的 `:::`。
 *
 * 自己按行扫而不是交给 remark-directive：这里需要精确区间（好把容器从正文里摘掉）、需要「未闭合」
 * 与「容器里又出现围栏」这两条自有诊断，也需要「同级并列、不嵌套」这条明确规则——嵌套交给 Markdown
 * 语义会变成「里面的围栏是内容」，用户写出半截容器的概率远高于真的想嵌套。
 */
import { type Interval, isSkipped } from "./regions.ts";

export type ContainerFence = {
  kind: "command" | "skill";
  name: string;
  /** 起始行行首到结束行行尾（不含结束行后的换行） */
  from: number;
  to: number;
  /** 内容的原文区间（已去掉紧邻围栏行的换行）；`contentFrom === contentTo` 表示空内容 */
  contentFrom: number;
  contentTo: number;
  /** 起始行行首的偏移，诊断与高亮用 */
  offset: number;
  closed: boolean;
  /** 内容里第一处容器围栏的偏移；同级并列的规则下这是写法错误，没有则 null */
  nestedAt: number | null;
};

/** 起始行：三个以上冒号 + 指令名 + 方括号里的名字，行内不允许再有别的内容 */
const OPEN_PATTERN = /^(:{3,})[ \t]*(command|skill)[ \t]*\[([^[\][\s]{1,64})\][ \t]*$/;
/** 结束行：只有冒号 */
const CLOSE_PATTERN = /^(:{3,})[ \t]*$/;

type Line = { text: string; from: number; to: number };

const linesOf = (markdown: string): Line[] => {
  const lines: Line[] = [];
  let from = 0;
  for (const text of markdown.split("\n")) {
    lines.push({ text, from, to: from + text.length });
    from += text.length + 1;
  }
  return lines;
};

const nestedOffsetIn = (
  markdown: string,
  contentFrom: number,
  contentTo: number,
): number | null => {
  for (const line of linesOf(markdown.slice(contentFrom, contentTo))) {
    if (OPEN_PATTERN.test(line.text)) return contentFrom + line.from;
  }
  return null;
};

export const scanContainers = (
  markdown: string,
  skipped: readonly Interval[],
): ContainerFence[] => {
  const lines = linesOf(markdown);
  const fences: ContainerFence[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isSkipped(skipped, line.from)) continue;

    const open = OPEN_PATTERN.exec(line.text);
    if (!open) continue;

    const fenceLength = open[1]?.length ?? 3;
    let closing = -1;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (!candidate) continue;
      const close = CLOSE_PATTERN.exec(candidate.text);
      if (close && (close[1]?.length ?? 0) >= fenceLength) {
        closing = next;
        break;
      }
    }

    const contentFrom =
      index + 1 < lines.length ? (lines[index + 1]?.from ?? markdown.length) : markdown.length;
    const closingLine = closing === -1 ? null : lines[closing];
    const contentTo = closingLine ? Math.max(contentFrom, closingLine.from - 1) : markdown.length;
    const lastLine = lines.at(-1);

    fences.push({
      kind: open[2] === "skill" ? "skill" : "command",
      name: open[3] ?? "",
      from: line.from,
      to: closingLine ? closingLine.to : (lastLine?.to ?? line.to),
      contentFrom,
      contentTo,
      offset: line.from,
      closed: closing !== -1,
      nestedAt: nestedOffsetIn(markdown, contentFrom, contentTo),
    });

    if (closing !== -1) index = closing;
  }

  return fences;
};
