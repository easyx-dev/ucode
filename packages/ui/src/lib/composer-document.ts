/**
 * 输入区文档模型与发送载荷的转换。
 *
 * 编辑器（Tiptap）的文档含段落、文本、硬换行、有序 / 无序列表与三个原子 mention 节点。
 * 这里只依赖节点的 JSON 形状（不 import Tiptap 类型），便于单测与复用。
 *
 * 附件在正文里留位置标记（`图片 N` / `附件 N.<ext>`，见 `@ucode/contracts` 的 markers）：
 * 服务端按标记就地展开，图片本体按标记顺序附在文本之后。标记口径由写它的 `docToPayload` 与
 * 渲染用的 `attachmentOrdinalInDoc` 共担，两处必须同源——所以两者都走同一套文档顺序遍历。
 * 列表按 Markdown 还原（`- ` / `1. `，嵌套缩进两空格）；`textToDoc` 反过来把这种文本还原成列表。
 */
import {
  type AttachmentRef,
  attachmentMarker,
  type ContextRef,
  imageMarker,
} from "@ucode/contracts";

import type { ComposerPayload } from "./composer-payload";
import { contextMarker } from "./message-chips";
import type { AttachmentView } from "./types";

export type ComposerNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ComposerNode[];
};

/** 命令 / 技能 mention 的判别值 */
export type MentionKind = "prompt" | "skill";

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const paragraphOf = (line: string): ComposerNode =>
  line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" };

const isListNode = (node: ComposerNode): boolean =>
  node.type === "bulletList" || node.type === "orderedList";

/** `@` 引用节点；`label` 是编辑器里显示的短名（只有文件名那一截） */
export const contextNode = (ref: ContextRef, label?: string): ComposerNode => ({
  type: "contextMention",
  attrs: {
    path: ref.path,
    startLine: ref.startLine ?? null,
    endLine: ref.endLine ?? null,
    label: label ?? null,
  },
});

/** `/` 命令与 `/skill:` 技能节点；`label` 是 `/name` 全文 */
export const commandNode = (name: string, kind: MentionKind): ComposerNode => ({
  type: "commandMention",
  attrs: { kind, name, label: kind === "skill" ? `/skill:${name}` : `/${name}` },
});

/** 附件节点；`tempId` 只在上传中非空，拿到 id 后清掉（见编辑器的 `resolveAttachment`） */
export const attachmentNode = (
  attachment: Pick<AttachmentView, "id" | "name" | "kind">,
  tempId: string | null = null,
): ComposerNode => ({
  type: "attachmentMention",
  attrs: {
    id: attachment.id,
    name: attachment.name ?? null,
    kind: attachment.kind,
    tempId,
  },
});

/** 正文侧要收集的东西：引用、附件与两类附件的计数（标记里的序号） */
type PayloadSink = {
  contexts: ContextRef[];
  attachments: AttachmentRef[];
  imageCount: number;
  fileCount: number;
};

/** 行内节点 → 文本：引用留标记、命令 / 技能还原、附件落成位置标记 */
const inlineTextOf = (nodes: readonly ComposerNode[], sink: PayloadSink): string => {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") {
      text += node.text ?? "";
      continue;
    }
    if (node.type === "hardBreak") {
      text += "\n";
      continue;
    }
    if (node.type === "contextMention") {
      const path = asString(node.attrs?.path);
      if (!path) continue;
      const startLine = asNumber(node.attrs?.startLine);
      const endLine = asNumber(node.attrs?.endLine);
      sink.contexts.push({
        path,
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
      });
      // 标记留在原位置：引用是句子成分，回放时不再是从句子里抽出来的 chip
      text += contextMarker(path);
      continue;
    }
    if (node.type === "commandMention") {
      const name = asString(node.attrs?.name);
      if (name) text += node.attrs?.kind === "skill" ? `/skill:${name}` : `/${name}`;
      continue;
    }
    if (node.type === "attachmentMention") {
      const id = asString(node.attrs?.id);
      // 还没拿到 id 的占位附件（上传中）不进正文也不进列表
      if (!id) continue;
      sink.attachments.push({ id });
      const name = asString(node.attrs?.name) || null;
      text +=
        node.attrs?.kind === "image"
          ? imageMarker(sink.imageCount++)
          : attachmentMarker(sink.fileCount++, name);
    }
  }
  return text;
};

/** 一个列表项的所有行：首段接在标记后面，嵌套列表与后续段落各自成行 */
const itemLinesOf = (
  item: ComposerNode,
  marker: string,
  depth: number,
  sink: PayloadSink,
): string[] => {
  const children = item.content ?? [];
  if (children.length === 0) return [marker.trimEnd()];
  const lines: string[] = [];
  children.forEach((child, position) => {
    if (isListNode(child)) {
      // 列表项里只有嵌套列表时，标记自己占一行（Markdown 也是这么写的）
      if (position === 0) lines.push(marker.trimEnd());
      lines.push(...listLinesOf(child, depth + 1, sink));
      return;
    }
    const text = inlineTextOf(child.content ?? [], sink);
    // 首段跟在标记后面，其余段落另起一行并对齐到内容缩进
    lines.push(position === 0 ? `${marker}${text}` : `${"  ".repeat(depth + 1)}${text}`);
  });
  return lines;
};

/** 列表 → Markdown 行：无序用 `- `，有序按位置编号，嵌套缩进两空格 */
const listLinesOf = (list: ComposerNode, depth: number, sink: PayloadSink): string[] => {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let ordinal = 0;
  for (const item of list.content ?? []) {
    if (item.type !== "listItem") continue;
    ordinal += 1;
    const marker = `${indent}${list.type === "orderedList" ? `${ordinal}. ` : "- "}`;
    lines.push(...itemLinesOf(item, marker, depth, sink));
  }
  return lines;
};

/** 块节点 → 行：列表展开成多行并加标记，其余（段落）就是一行 */
const blockLinesOf = (node: ComposerNode, depth: number, sink: PayloadSink): string[] =>
  isListNode(node) ? listLinesOf(node, depth, sink) : [inlineTextOf(node.content ?? [], sink)];

/**
 * 文档 → 载荷：引用 mention 在正文里落成 `@路径` 标记并收进 `contexts`，命令 / 技能还原为
 * `/name`、`/skill:name`，列表还原成 Markdown 行，附件落成位置标记并按出现顺序收进 `attachments`。
 *
 * 还没拿到 id 的占位附件（上传中）不进正文也不进列表——`submit` 已被 `hasPendingUploads` 挡住。
 */
export const docToPayload = (doc: ComposerNode | null | undefined): ComposerPayload => {
  const sink: PayloadSink = { contexts: [], attachments: [], imageCount: 0, fileCount: 0 };
  const lines: string[] = [];
  for (const node of doc?.content ?? []) lines.push(...blockLinesOf(node, 0, sink));
  return { text: lines.join("\n"), contexts: sink.contexts, attachments: sink.attachments };
};

/** 附件节点的身份：拿到 id 后用 id，上传中的占位用 tempId；两者都没有时为空串 */
const attachmentKeyOf = (node: ComposerNode): string => {
  const id = asString(node.attrs?.id);
  return id || asString(node.attrs?.tempId);
};

/**
 * 附件在文档里的同类序号（1 起）：与 `docToPayload` 写进正文的 `图片 N` / `附件 N` 同一口径，
 * 编辑器据此把节点显示成 `图片n`。`key` 取节点的 id（上传中的占位取 tempId），文档内唯一。
 *
 * 与 `docToPayload` 的已知差异：占位节点在这里照样占号，而 `docToPayload` 遇到没 id 的节点会跳过。
 * 上传期间两者可能短暂对不上，但发送被 `hasPendingUploads` 挡住，落盘前必然收敛。
 */
export const attachmentOrdinalInDoc = (
  doc: ComposerNode | null | undefined,
  key: string,
  kind: AttachmentView["kind"],
): number => {
  if (!key) return 0;
  let ordinal = 0;
  let found = 0;
  // 与 `docToPayload` 同序：按文档顺序递归，列表里的附件也算数
  const walk = (nodes: readonly ComposerNode[]): void => {
    for (const node of nodes) {
      if (node.type === "attachmentMention" && node.attrs?.kind === kind) {
        ordinal += 1;
        if (found === 0 && attachmentKeyOf(node) === key) found = ordinal;
      }
      if (node.content) walk(node.content);
    }
  };
  walk(doc?.content ?? []);
  return found;
};

/** 文档是否为空（无任何文本、引用与附件） */
export const isDocEmpty = (doc: ComposerNode | null | undefined): boolean => {
  const payload = docToPayload(doc);
  return (
    payload.text.trim() === "" && payload.contexts.length === 0 && payload.attachments.length === 0
  );
};

/** 一行文本的解析结果：列表行（带缩进与标记种类）或普通文本行 */
type DocLine =
  | { kind: "list"; indent: number; marker: "bullet" | "ordered"; text: string }
  | { kind: "text"; text: string };

/** 列表行：`- x` / `* x` / `+ x` / `1. x`，缩进按两空格一层 */
const LIST_LINE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

const parseLine = (line: string): DocLine => {
  const match = LIST_LINE.exec(line);
  if (!match) return { kind: "text", text: line };
  const marker = match[2] ?? "-";
  return {
    kind: "list",
    indent: Math.floor((match[1]?.length ?? 0) / 2),
    marker: marker === "-" || marker === "*" || marker === "+" ? "bullet" : "ordered",
    text: match[3] ?? "",
  };
};

/** 从 `start` 起把同层同类的列表行收成一个列表，缩进更深的行收进上一个列表项 */
const listDocOf = (
  lines: readonly DocLine[],
  start: number,
  depth: number,
): [ComposerNode, number] => {
  const head = lines[start];
  const marker = head?.kind === "list" ? head.marker : "bullet";
  const list: ComposerNode = {
    type: marker === "ordered" ? "orderedList" : "bulletList",
    content: [],
  };
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.kind !== "list" || line.indent !== depth || line.marker !== marker) break;
    const item: ComposerNode = { type: "listItem", content: [paragraphOf(line.text)] };
    index += 1;
    while (index < lines.length) {
      const nested = lines[index];
      if (!nested || nested.kind !== "list" || nested.indent <= depth) break;
      const [child, next] = listDocOf(lines, index, nested.indent);
      item.content?.push(child);
      index = next;
    }
    list.content?.push(item);
  }
  return [list, index];
};

/** 纯文本 → 文档（建议 chips、失败回填、命令填充用）；`- ` / `1. ` 行还原成列表，缩进还原嵌套 */
export const textToDoc = (text: string): ComposerNode => {
  const lines = text.split("\n").map(parseLine);
  const content: ComposerNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.kind === "list") {
      const [list, next] = listDocOf(lines, index, line.indent);
      content.push(list);
      index = next;
      continue;
    }
    content.push(paragraphOf(line.text));
    index += 1;
  }
  return { type: "doc", content };
};
