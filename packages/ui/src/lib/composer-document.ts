/**
 * 输入区文档模型与发送载荷的转换。
 *
 * 编辑器（Tiptap）的文档只含段落、文本、硬换行与三个原子 mention 节点。
 * 这里只依赖节点的 JSON 形状（不 import Tiptap 类型），便于单测与复用。
 *
 * 附件在正文里留位置标记（`图片 N` / `附件 N.<ext>`，见 `@ucode/contracts` 的 markers）：
 * 服务端按标记就地展开，图片本体按标记顺序附在文本之后。
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

/**
 * 文档 → 载荷：引用 mention 在正文里落成 `@路径` 标记并收进 `contexts`，命令 / 技能还原为
 * `/name`、`/skill:name`，附件落成位置标记并按出现顺序收进 `attachments`。
 *
 * 还没拿到 id 的占位附件（上传中）不进正文也不进列表——`submit` 已被 `hasPendingUploads` 挡住。
 */
export const docToPayload = (doc: ComposerNode | null | undefined): ComposerPayload => {
  const contexts: ContextRef[] = [];
  const attachments: AttachmentRef[] = [];
  const lines: string[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const paragraph of doc?.content ?? []) {
    let line = "";
    for (const node of paragraph.content ?? []) {
      if (node.type === "text") {
        line += node.text ?? "";
      } else if (node.type === "hardBreak") {
        line += "\n";
      } else if (node.type === "contextMention") {
        const path = asString(node.attrs?.path);
        if (path) {
          const startLine = asNumber(node.attrs?.startLine);
          const endLine = asNumber(node.attrs?.endLine);
          contexts.push({
            path,
            ...(startLine !== undefined ? { startLine } : {}),
            ...(endLine !== undefined ? { endLine } : {}),
          });
          // 标记留在原位置：引用是句子成分，回放时不再是从句子里抽出来的 chip
          line += contextMarker(path);
        }
      } else if (node.type === "commandMention") {
        const name = asString(node.attrs?.name);
        if (name) line += node.attrs?.kind === "skill" ? `/skill:${name}` : `/${name}`;
      } else if (node.type === "attachmentMention") {
        const id = asString(node.attrs?.id);
        if (!id) continue;
        attachments.push({ id });
        const name = asString(node.attrs?.name) || null;
        line +=
          node.attrs?.kind === "image"
            ? imageMarker(imageCount++)
            : attachmentMarker(fileCount++, name);
      }
    }
    lines.push(line);
  }

  return { text: lines.join("\n"), contexts, attachments };
};

/** 文档是否为空（无任何文本、引用与附件） */
export const isDocEmpty = (doc: ComposerNode | null | undefined): boolean => {
  const payload = docToPayload(doc);
  return (
    payload.text.trim() === "" && payload.contexts.length === 0 && payload.attachments.length === 0
  );
};

/** 纯文本 → 段落文档（建议 chips、失败回填、命令填充用）；换行拆成多段 */
export const textToDoc = (text: string): ComposerNode => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  })),
});
