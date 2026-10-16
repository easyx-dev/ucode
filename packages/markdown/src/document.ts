/**
 * 编辑器文档（节点 JSON）→ 方言文本，以及附件类型标记的推导。
 *
 * 文档是方言的**视图**：用户看到的是芯片，持久化与传输的那份东西是方言文本。发送、编辑回填、
 * 草稿与复制都走这条投影，三处口径因此是同一份。
 *
 * 只依赖节点的 JSON 形状（见 `doc-nodes.ts`），列表按 Markdown 还原（`- ` / `1. `，嵌套缩进两空格）。
 */
import { scanContainers } from "./containers.ts";
import type { DocNode } from "./doc-nodes.ts";
import { nonParsedIntervals, parseMarkdownTree } from "./regions.ts";
import {
  DIALECT_ATTACHMENT_KINDS,
  type DialectAttachmentKind,
  type InvocationCandidates,
} from "./types.ts";

export type { DocNode };

export type DocToDialectOptions = {
  /** 命令 / 技能清单：手打的 `/名字` 只有命中清单才当命令；缺省即不做这层定形糖 */
  candidates?: InvocationCandidates | undefined;
  /** 留给客户端自己解析的命令名（如 `/goal`）：不在这里当命令容器 */
  reserved?: readonly string[] | undefined;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const isListNode = (node: DocNode): boolean =>
  node.type === "bulletList" || node.type === "orderedList";

/** 文件扩展名 → scheme 类型；认不出按 `binary`（展示层只影响图标） */
const EXTENSION_KINDS: Record<string, DialectAttachmentKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  pdf: "pdf",
  md: "text",
  txt: "text",
  json: "text",
  yml: "text",
  yaml: "text",
  csv: "sheet",
  xls: "sheet",
  xlsx: "sheet",
  doc: "doc",
  docx: "doc",
  ppt: "slide",
  pptx: "slide",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  "7z": "archive",
  mp3: "audio",
  wav: "audio",
  mp4: "video",
  mov: "video",
};

export const schemeKindFromName = (name: string | null): DialectAttachmentKind => {
  const ext = name ? /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase() : undefined;
  return (ext && EXTENSION_KINDS[ext]) || "binary";
};

/** mimeType → scheme 类型（上传时就记在附件节点上，免得每次投影都要猜） */
export const schemeKindOfMime = (mimeType: string): DialectAttachmentKind => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/")) return "text";
  const known: Record<string, DialectAttachmentKind> = {
    "application/pdf": "pdf",
    "application/json": "text",
    "application/xml": "text",
    "application/zip": "archive",
    "application/gzip": "archive",
    "application/x-tar": "archive",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
    "application/vnd.ms-excel": "sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slide",
    "application/vnd.ms-powerpoint": "slide",
  };
  return known[mimeType] ?? "binary";
};

export const isDialectAttachmentKind = (value: string): value is DialectAttachmentKind =>
  (DIALECT_ATTACHMENT_KINDS as readonly string[]).includes(value);

/** `:::`（行首的容器围栏）在容器内容里必须转义，否则会提前闭合当前容器 */
export const guardFences = (text: string): string => text.replaceAll(/(^|\n)(:{3,})/g, "$1\\$2");

/** 引用写成方言：路径含空白时用方括号写法，行范围两段都带 `L` */
const contextToDialect = (path: string, startLine?: number, endLine?: number): string => {
  const suffix = startLine ? (endLine ? `#L${startLine}-L${endLine}` : `#L${startLine}`) : "";
  return /[ \t]/.test(path) ? `@[${path}](${path}${suffix})` : `@${path}${suffix}`;
};

const attachmentToDialect = (
  id: string,
  kind: DialectAttachmentKind,
  name: string | null,
): string => `![${name && kind !== "image" ? name : ""}](attachment:${kind}/${id})`;

type Projection = {
  /** 已定形的命令 / 技能（文档里的第一枚命令节点） */
  command: { kind: "prompt" | "skill"; name: string } | null;
  /** 命令节点之后紧跟的分隔空白还没吃掉 */
  skipSeparator: boolean;
};

const inlineTextOf = (nodes: readonly DocNode[], state: Projection): string => {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") {
      let value = node.text ?? "";
      if (state.skipSeparator) {
        state.skipSeparator = false;
        value = value.replace(/^\s/u, "");
      }
      text += value;
      continue;
    }
    if (node.type === "hardBreak") {
      text += "\n";
      continue;
    }
    if (node.type === "contextMention") {
      const path = asString(node.attrs?.path);
      if (path)
        text += contextToDialect(
          path,
          asNumber(node.attrs?.startLine),
          asNumber(node.attrs?.endLine),
        );
      continue;
    }
    if (node.type === "commandMention") {
      const name = asString(node.attrs?.name);
      if (!name) continue;
      const kind = node.attrs?.kind === "skill" ? "skill" : "prompt";
      // 一条消息只可能是一条命令；之后再出现（界面挡着，理论上不会有）就当字面留着，不静默丢字
      if (!state.command) {
        state.command = { kind, name };
        state.skipSeparator = true;
        continue;
      }
      text += kind === "skill" ? `/skill:${name}` : `/${name}`;
      continue;
    }
    if (node.type === "pageElementMention") {
      // 芯片在方言里落成完整摘要：模型看字段，芯片只是给人看的
      text += asString(node.attrs?.summary);
      continue;
    }
    if (node.type === "attachmentMention") {
      const id = asString(node.attrs?.id);
      // 上传中的占位没有 id：不进方言（`submit` 已被 `hasPendingUploads` 挡住）
      if (!id) continue;
      const name = asString(node.attrs?.name) || null;
      const stored = asString(node.attrs?.schemeKind);
      const kind = isDialectAttachmentKind(stored)
        ? stored
        : node.attrs?.kind === "image"
          ? "image"
          : schemeKindFromName(name);
      text += attachmentToDialect(id, kind, name);
    }
  }
  return text;
};

/** 列表项的所有行：首段接在标记后面，嵌套列表与后续段落各自成行 */
const itemLinesOf = (item: DocNode, marker: string, depth: number, state: Projection): string[] => {
  const children = item.content ?? [];
  if (children.length === 0) return [marker.trimEnd()];
  const lines: string[] = [];
  children.forEach((child, position) => {
    if (isListNode(child)) {
      if (position === 0) lines.push(marker.trimEnd());
      lines.push(...listLinesOf(child, depth + 1, state));
      return;
    }
    const text = inlineTextOf(child.content ?? [], state);
    lines.push(position === 0 ? `${marker}${text}` : `${"  ".repeat(depth + 1)}${text}`);
  });
  return lines;
};

/** 列表 → Markdown 行：无序用 `- `，有序按位置编号，嵌套缩进两空格 */
const listLinesOf = (list: DocNode, depth: number, state: Projection): string[] => {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let ordinal = 0;
  for (const item of list.content ?? []) {
    if (item.type !== "listItem") continue;
    ordinal += 1;
    const marker = `${indent}${list.type === "orderedList" ? `${ordinal}. ` : "- "}`;
    lines.push(...itemLinesOf(item, marker, depth, state));
  }
  return lines;
};

const bodyOf = (doc: DocNode | null | undefined, state: Projection): string => {
  const lines: string[] = [];
  for (const node of doc?.content ?? []) {
    lines.push(
      ...(isListNode(node)
        ? listLinesOf(node, 0, state)
        : [inlineTextOf(node.content ?? [], state)]),
    );
  }
  return lines.join("\n").trim();
};

const containerOf = (kind: "command" | "skill", name: string, args: string): string =>
  args ? `:::${kind}[${name}]\n${guardFences(args)}\n:::` : `:::${kind}[${name}]\n:::`;

/**
 * 手打的 `/名字 参数` 是输入糖：命中清单（且不是留给客户端自己的名字）就整段变成容器。
 * 方言本身只承认容器写法，糖在投影这一层就化了，投递出去的文本里不会有两种命令写法。
 */
const expandHandTyped = (text: string, options: DocToDialectOptions): string => {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
  const head = match?.[1];
  if (!head) return text;
  if (options.reserved?.includes(head)) return text;

  const candidates = options.candidates;
  if (!candidates) return text;

  const args = match?.[2] ?? "";
  if (head.startsWith("skill:")) {
    const name = head.slice("skill:".length);
    if (!name || !candidates.skills.some((item) => item.name === name)) return text;
    return containerOf("skill", name, args);
  }
  if (!candidates.prompts.some((item) => item.name === head)) return text;
  return containerOf("command", head, args);
};

/**
 * 正文拆成「容器块」与其余文本。用户手打的容器是**兄弟块**，不能塞进命令参数里
 * ——塞进去要么被当成参数的一部分（技能不生效），要么被转义成字面文字（静默丢语义）。
 *
 * 代码区内的围栏行不算容器，判据与 `parseDialect` 完全一致（同一套 remark 扫描）。
 */
const splitContainers = (body: string): { containers: string[]; text: string } => {
  const skipped = nonParsedIntervals(parseMarkdownTree(body));
  const fences = scanContainers(body, skipped);
  if (fences.length === 0) return { containers: [], text: body };

  const containers: string[] = [];
  let text = "";
  let cursor = 0;
  for (const fence of fences) {
    text += body.slice(cursor, fence.from);
    containers.push(body.slice(fence.from, fence.to).trim());
    cursor = fence.to;
  }
  text += body.slice(cursor);
  return { containers, text: text.trim().replaceAll(/\n{3,}/g, "\n\n") };
};

/**
 * 文档 → 方言。拼装顺序：命令容器（参数是除容器外的正文）→ 手打的容器（保持原顺序）→ 正文。
 * 与投递顺序（命令块 → 技能块 → 用户正文）一致，所以「输入、条目、回显」看到的是同一件事。
 */
export const docToDialect = (
  doc: DocNode | null | undefined,
  options: DocToDialectOptions,
): string => {
  const state: Projection = { command: null, skipSeparator: false };
  const { containers, text } = splitContainers(bodyOf(doc, state));
  const { command } = state;

  if (command) {
    const head = containerOf(command.kind === "skill" ? "skill" : "command", command.name, text);
    return [head, ...containers].filter(Boolean).join("\n\n");
  }
  // 没有命令节点时，手打的 `/名字 参数` 定形糖作用在除容器外的正文上；容器保持自己的内容
  return [expandHandTyped(text, options), ...containers].filter(Boolean).join("\n\n");
};
