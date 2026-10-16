/**
 * 行内记号：`@引用`、`![名字](attachment:类型/id)`、`\` 转义。
 *
 * 输入是原文的一个区间与它的非解析区；输出按出现顺序的记号，认不出的字符原样留在文本记号里。
 * 这里不查附件库、也不查引用是否存在——scheme 自带类型，路径是否存在由服务端在读文件时报错。
 */
import { type Interval, isSkipped } from "./regions.ts";
import { DIALECT_ATTACHMENT_KINDS, type DialectAttachmentKind } from "./types.ts";

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "context"; path: string; startLine?: number; endLine?: number }
  | {
      kind: "attachment";
      id: string;
      schemeKind: DialectAttachmentKind;
      name: string | null;
    };

export type InlineScan = {
  tokens: InlineToken[];
  /** scheme 写了 `attachment:` 但类型或 id 不合法：按字面处理，并留一条提示 */
  invalidAttachments: { raw: string; offset: number }[];
};

const ATTACHMENT_PREFIX = "attachment:";
const ID_PATTERN = /^[0-9a-f]{64}$/;
/** 裸引用路径的终止字符：空白与中英文标点都不进路径 */
const PATH_STOP = new Set([..." \t\r\n[]()<>\"'`|", ..."，。；：？！、（）【】《》“”‘’…"]);
/** 行范围：`#L10`、`#L10-L40`、`#L10-`（两段都带 `L`，与编辑器插入的写法一致） */
const LINE_RANGE_PATTERN = /#L(\d+)(?:-L(\d*))?$/;
/** `@` 前是 ASCII 词字符时不算引用，`foo@bar.com` 保持字面；中文相邻照算（`看下@src/a.ts`） */
const ASCII_WORD = /[A-Za-z0-9_]/;
/** 裸写法要求路径像路径（含 `/` 或 `.`），`@用户名` 这类保持字面 */
const PATH_SHAPE = /[/.]/;

const kindOf = (value: string): DialectAttachmentKind | null =>
  (DIALECT_ATTACHMENT_KINDS as readonly string[]).includes(value)
    ? (value as DialectAttachmentKind)
    : null;

/** `![label](attachment:kind/id)`：返回记号与消耗到的偏移，不成形返回 null */
const matchAttachment = (
  source: string,
  from: number,
  to: number,
):
  | { token: InlineToken; to: number }
  | { invalid: { raw: string; offset: number }; to: number }
  | null => {
  if (!source.startsWith("![", from)) return null;

  let index = from + 2;
  while (index < to && source[index] !== "]") {
    if (source[index] === "\\") index += 1;
    index += 1;
  }
  const label = source.slice(from + 2, index).replaceAll(/\\(.)/g, "$1");
  if (index + 1 >= to || !source.startsWith("](", index)) return null;

  const targetFrom = index + 2;
  if (!source.startsWith(ATTACHMENT_PREFIX, targetFrom)) return null;

  const schemeFrom = targetFrom + ATTACHMENT_PREFIX.length;
  // 只在本区间里找分隔与收尾：`indexOf` 会一路搜到后面去（比如跨越下一个容器），
  // 那样诊断会把别的区域的字当成本处的引用，也会读到不该读的地方
  const slash = source.indexOf("/", schemeFrom);
  const end = source.indexOf(")", schemeFrom);
  if (slash === -1 || end === -1 || slash > end || slash >= to || end >= to) return null;

  const raw = source.slice(from, end + 1);
  const schemeKind = kindOf(source.slice(schemeFrom, slash));
  const id = source.slice(slash + 1, end);
  if (!schemeKind || !ID_PATTERN.test(id)) return { invalid: { raw, offset: from }, to: end + 1 };

  return { token: { kind: "attachment", id, schemeKind, name: label || null }, to: end + 1 };
};

/** `@path#L1-L2` 或 `@[显示名](path#L1-L2)`：返回记号与消耗到的偏移，不成形返回 null */
const matchContext = (
  source: string,
  from: number,
  to: number,
): { token: InlineToken; to: number } | null => {
  if (source[from] !== "@") return null;
  if (from > 0 && ASCII_WORD.test(source[from - 1] ?? "")) return null;

  const bracket = source.startsWith("@[", from);
  let pathFrom = from + 1;
  let pathTo = from + 1;
  let end = pathTo;

  if (bracket) {
    const labelEnd = source.indexOf("](", from + 2);
    const pathEnd = labelEnd === -1 ? -1 : source.indexOf(")", labelEnd + 2);
    if (labelEnd === -1 || pathEnd === -1 || pathEnd >= to) return null;
    pathFrom = labelEnd + 2;
    pathTo = pathEnd;
    end = pathEnd + 1;
  } else {
    while (pathTo < to && !PATH_STOP.has(source[pathTo] ?? "")) pathTo += 1;
    end = pathTo;
  }

  const raw = source.slice(pathFrom, pathTo).replaceAll(/\\(.)/g, "$1");
  if (!raw) return null;

  const range = LINE_RANGE_PATTERN.exec(raw);
  const path = range ? raw.slice(0, raw.length - range[0].length) : raw;
  if (!PATH_SHAPE.test(path)) return null;

  const token: InlineToken = {
    kind: "context",
    path,
    ...(range?.[1] ? { startLine: Number.parseInt(range[1], 10) } : {}),
    ...(range?.[2] ? { endLine: Number.parseInt(range[2], 10) } : {}),
  };
  return { token, to: end };
};

export const scanInline = (
  source: string,
  range: Interval,
  skipped: readonly Interval[],
): InlineScan => {
  const tokens: InlineToken[] = [];
  const invalidAttachments: { raw: string; offset: number }[] = [];
  let text = "";

  const flush = (): void => {
    if (text) tokens.push({ kind: "text", text });
    text = "";
  };

  let index = range.from;
  while (index < range.to) {
    const char = source[index] ?? "";
    if (isSkipped(skipped, index)) {
      text += char;
      index += 1;
      continue;
    }
    if (char === "\\" && index + 1 < range.to) {
      text += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === "!") {
      const attachment = matchAttachment(source, index, range.to);
      if (attachment) {
        if ("invalid" in attachment) {
          // 认不出就按字面留着：用户的字不能因为一处写错就悄悄消失
          invalidAttachments.push(attachment.invalid);
          text += source.slice(index, attachment.to);
        } else {
          flush();
          tokens.push(attachment.token);
        }
        index = attachment.to;
        continue;
      }
    }
    if (char === "@") {
      const context = matchContext(source, index, range.to);
      if (context) {
        flush();
        tokens.push(context.token);
        index = context.to;
        continue;
      }
    }
    text += char;
    index += 1;
  }

  flush();
  return { tokens, invalidAttachments };
};
