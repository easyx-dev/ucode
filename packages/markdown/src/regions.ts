/**
 * 非解析区：交给 remark 找出行内记号与容器围栏都不生效的区间（代码块、行内代码、HTML）。
 *
 * 自己扫 Markdown 的边界规则（多反引号、缩进代码块、HTML 块）容易漏，所以这一层用成熟解析器；
 * 容器围栏与行内记号仍由本包按行/按字符扫，因为需要精确区间与「未闭合」「同级并列」这些自有规则。
 */
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** 原文里的一个半开区间 */
export type Interval = { from: number; to: number };

/** `code` 覆盖整块（围栏与缩进代码块），`inlineCode` 与 `html` 覆盖行内片段 */
const NON_PARSED_TYPES = new Set(["code", "inlineCode", "html"]);

export const parseMarkdownTree = (markdown: string): Root =>
  unified().use(remarkParse).use(remarkGfm).parse(markdown);

export const nonParsedIntervals = (tree: Root): Interval[] => {
  const intervals: Interval[] = [];
  visit(tree, (node) => {
    if (!NON_PARSED_TYPES.has(node.type)) return;
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined || to <= from) return;
    intervals.push({ from, to });
  });
  return intervals;
};

/** 偏移是否落在非解析区里；一条消息里区间数量很小，线性扫足够 */
export const isSkipped = (intervals: readonly Interval[], offset: number): boolean =>
  intervals.some((interval) => offset >= interval.from && offset < interval.to);
