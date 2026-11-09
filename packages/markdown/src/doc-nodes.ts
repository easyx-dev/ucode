/**
 * 编辑器文档（节点 JSON）的构造与还原：段落、列表、硬换行与三个原子 mention 节点。
 *
 * 只依赖节点的 JSON 形状（不 import Tiptap 类型），web、桌面端、TUI 与单测因此共用同一套规则：
 * 列表按 Markdown 还原（`- ` / `1. `，嵌套缩进两空格），`textToDoc` 反过来把这种文本还原成列表。
 * 投影成方言（`docToDialect`）与投影成载荷都由这里构造出来的节点形状决定。
 */
import type { AttachmentView, ContextRef } from "@ucode/contracts";

import { docToDialect } from "./document.ts";

export type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

/** 命令 / 技能 mention 的判别值 */
export type MentionKind = "prompt" | "skill";

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const paragraphOf = (line: string): DocNode =>
  line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" };

const isListNode = (node: DocNode): boolean =>
  node.type === "bulletList" || node.type === "orderedList";

/** `@` 引用节点；`label` 是编辑器里显示的短名（只有文件名那一截） */
export const contextNode = (ref: ContextRef, label?: string): DocNode => ({
  type: "contextMention",
  attrs: {
    path: ref.path,
    startLine: ref.startLine ?? null,
    endLine: ref.endLine ?? null,
    label: label ?? null,
  },
});

/** `/` 命令与 `/skill:` 技能节点；`label` 是 `/name` 全文 */
export const commandNode = (name: string, kind: MentionKind): DocNode => ({
  type: "commandMention",
  attrs: { kind, name, label: kind === "skill" ? `/skill:${name}` : `/${name}` },
});

/** 页面元素上下文节点名；编辑器节点视图与载荷生成都按它找（见 `pageElementNode`） */
export const PAGE_ELEMENT_NODE = "pageElementMention";

/** 桌面端面板「元素选择」插进来的那份上下文 */
export type PageElementContext = {
  /** 芯片上的短名（元素的可访问名，没有就退标签） */
  label: string;
  /** 进消息正文的完整摘要（多行）；采摘口径在宿主那边，这里只负责带过去 */
  summary: string;
  url?: string;
  title?: string;
  selector?: string;
};

/**
 * 页面元素节点：编辑器里是**一枚芯片**（整段摘要塞进输入框会很难看），进消息正文的仍是完整摘要
 * ——模型要的是字段，人要的是不挡视线的地方。
 */
export const pageElementNode = (context: PageElementContext): DocNode => ({
  type: PAGE_ELEMENT_NODE,
  attrs: {
    label: context.label,
    summary: context.summary,
    url: context.url ?? null,
    title: context.title ?? null,
    selector: context.selector ?? null,
  },
});

/** 引用锚点的节点名；编辑器节点视图与载荷生成都按它找（见 `mentionNode`） */
export const MENTION_NODE = "mentionChip";

/**
 * 一枚引用锚点芯片：与页面元素同一套「芯片给人看、锚点给模型」的分工。
 *
 * `anchor` 形如 `@<scheme>:<payload>`——由插件铸造、插件校验归属；模型把它原样当引用参数传回去。
 * 内核不认识 scheme 的语义，只负责把它原样留在正文里、在界面上显示成一枚芯片。
 */
export const mentionNode = (context: {
  scheme: string;
  label: string;
  anchor: string;
}): DocNode => ({
  type: MENTION_NODE,
  attrs: { scheme: context.scheme, label: context.label, anchor: context.anchor },
});

/** 附件节点；`tempId` 只在上传中非空，拿到 id 后清掉（见编辑器的 `resolveAttachment`） */
export const attachmentNode = (
  attachment: Pick<AttachmentView, "id" | "name" | "kind">,
  tempId: string | null = null,
): DocNode => ({
  type: "attachmentMention",
  attrs: {
    id: attachment.id,
    name: attachment.name ?? null,
    kind: attachment.kind,
    tempId,
  },
});

/** 附件节点的身份：拿到 id 后用 id，上传中的占位用 tempId；两者都没有时为空串 */
const attachmentKeyOf = (node: DocNode): string => {
  const id = asString(node.attrs?.id);
  return id || asString(node.attrs?.tempId);
};

/**
 * 附件在文档里的同类序号（1 起）：与方言投影写进正文的 `图片 N` / `附件 N` 同一口径，
 * 编辑器据此把节点显示成 `图片n`。`key` 取节点的 id（上传中的占位取 tempId），文档内唯一。
 *
 * 已知差异：占位节点（还没拿到 id）在这里照样占号，而方言投影会跳过它。
 * 上传期间两者可能短暂对不上，但发送被 `hasPendingUploads` 挡住，落盘前必然收敛。
 */
export const attachmentOrdinalInDoc = (
  doc: DocNode | null | undefined,
  key: string,
  kind: AttachmentView["kind"],
): number => {
  if (!key) return 0;
  let ordinal = 0;
  let found = 0;
  // 与方言投影同序：按文档顺序递归，列表里的附件也算数
  const walk = (nodes: readonly DocNode[]): void => {
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
/** 文档是否为空：投影成方言以后没有任何字（只有命令节点、没有正文也算有内容） */
export const isDocEmpty = (doc: DocNode | null | undefined): boolean =>
  docToDialect(doc, {}).trim() === "";

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
const listDocOf = (lines: readonly DocLine[], start: number, depth: number): [DocNode, number] => {
  const head = lines[start];
  const marker = head?.kind === "list" ? head.marker : "bullet";
  const list: DocNode = {
    type: marker === "ordered" ? "orderedList" : "bulletList",
    content: [],
  };
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.kind !== "list" || line.indent !== depth || line.marker !== marker) break;
    const item: DocNode = { type: "listItem", content: [paragraphOf(line.text)] };
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

/**
 * 往现有文档尾部追加一段文本（保留已有内容与结构）。
 *
 * 用于「外部把一段内容加进输入框」这类插入（选中的页面元素、引用等）：与「编辑重发」「/命令填充」
 * 同一条路——改草稿的 doc，输入框自己会同步；空文档时直接用要追加的内容当正文。
 */
export const appendNodesToDoc = (
  doc: DocNode | null | undefined,
  nodes: readonly DocNode[],
): DocNode => {
  const base: DocNode = doc && !isDocEmpty(doc) ? doc : { type: "doc", content: [] };
  return { ...base, content: [...(base.content ?? []), ...nodes] };
};

/** 文本次之：追加一段文本（按 Markdown 还原成段落与列表） */
export const appendTextToDoc = (doc: DocNode | null | undefined, text: string): DocNode =>
  appendNodesToDoc(doc, textToDoc(text).content ?? []);

/** 纯文本 → 文档（建议 chips、失败回填、命令填充用）；`- ` / `1. ` 行还原成列表，缩进还原嵌套 */
export const textToDoc = (text: string): DocNode => {
  const lines = text.split("\n").map(parseLine);
  const content: DocNode[] = [];
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
