/**
 * 输入区文档模型与发送载荷的转换。
 *
 * 编辑器（Tiptap）的文档只含段落、文本、硬换行与两个原子 mention 节点。
 * 这里只依赖节点的 JSON 形状（不 import Tiptap 类型），便于单测与复用。
 */
import type { ContextRef } from "@ucode/contracts";

import type { ComposerPayload } from "./composer-payload";

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

/** 文档 → 载荷：mention 从正文剥离，命令 / 技能还原为 `/name`、`/skill:name` */
export const docToPayload = (doc: ComposerNode | null | undefined): ComposerPayload => {
  const contexts: ContextRef[] = [];
  const lines: string[] = [];

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
        }
      } else if (node.type === "commandMention") {
        const name = asString(node.attrs?.name);
        if (name) line += node.attrs?.kind === "skill" ? `/skill:${name}` : `/${name}`;
      }
    }
    lines.push(line);
  }

  return { text: lines.join("\n"), contexts, attachments: [] };
};

/** 文档是否为空（无任何文本与 mention） */
export const isDocEmpty = (doc: ComposerNode | null | undefined): boolean => {
  const payload = docToPayload(doc);
  return payload.text.trim() === "" && payload.contexts.length === 0;
};

/** 纯文本 → 单段落文档（建议 chips、失败回填用） */
export const textToDoc = (text: string): ComposerNode => ({
  type: "doc",
  content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }],
});
