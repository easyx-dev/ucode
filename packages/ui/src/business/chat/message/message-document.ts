/**
 * 会话条目里的用户消息 → 编辑器文档：编辑重发复用输入区的编辑器，因此正文里的位置标记要还原成节点。
 *
 * 复用同一套扫描（`message-chips` 的分段）与同一批节点构造（`composer-document`），
 * 这样「编辑重发」与「首次发送」走的是同一条投递口径：文档 → `docToPayload` → 标记 → 服务端展开。
 */

import { baseName } from "../../../utils/path";
import {
  attachmentNode,
  type ComposerNode,
  commandNode,
  contextNode,
} from "../../composer/document/composer-document";
import type { ParsedUserMessage } from "../../composer/document/message-chips";

/**
 * `images` 是本条消息的图片块 id（按出现顺序）：条目正文里图片只有 `图片 N` 标记，
 * 本体在图片块上，按序号取回。取不到（序号越界）就丢掉这个节点——宁可少一张图，
 * 也不发一个指向不存在附件的引用出去。
 */
export const messageTextToDoc = (
  parsed: ParsedUserMessage,
  images: readonly string[],
): ComposerNode => {
  const paragraphs: ComposerNode[][] = [[]];
  const current = (): ComposerNode[] => paragraphs[paragraphs.length - 1] as ComposerNode[];
  const push = (node: ComposerNode): void => {
    current().push(node);
  };
  const breakLine = (): void => {
    paragraphs.push([]);
  };

  // 命令 / 技能还原成 mention 节点（命令名之后补一个空格，否则正文里的参数会贴上去）
  if (parsed.skill) {
    push(commandNode(parsed.skill.name, "skill"));
    push({ type: "text", text: " " });
  } else if (parsed.command) {
    push(commandNode(parsed.command.name, "prompt"));
    push({ type: "text", text: " " });
    // 提示词命令的参数只在展开块的 `args` 属性里（服务端不把它接在块后，与技能不同），
    // 正文为空时把它补回去——否则改写一条 `/review 改动 a.ts` 会变成裸的 `/review`
    if (parsed.command.args && parsed.segments.length === 0) {
      push({ type: "text", text: parsed.command.args });
    }
  }

  for (const segment of parsed.segments) {
    if (segment.type === "text") {
      // 换行拆成新段落：文档模型里段落之间就是换行，与 `docToPayload` 的拼接口径一致
      segment.text.split("\n").forEach((line, index) => {
        if (index > 0) breakLine();
        if (line) push({ type: "text", text: line });
      });
      continue;
    }
    if (segment.type === "context") {
      push(
        contextNode(
          {
            path: segment.path,
            ...(segment.startLine !== undefined ? { startLine: segment.startLine } : {}),
            ...(segment.endLine !== undefined ? { endLine: segment.endLine } : {}),
          },
          baseName(segment.path),
        ),
      );
      continue;
    }
    if (segment.type === "attachment") {
      push(attachmentNode({ id: segment.id, name: segment.name, kind: "file" }));
      continue;
    }
    const id = images[segment.index - 1];
    if (id) push(attachmentNode({ id, name: null, kind: "image" }));
  }

  return { type: "doc", content: paragraphs.map((content) => ({ type: "paragraph", content })) };
};
