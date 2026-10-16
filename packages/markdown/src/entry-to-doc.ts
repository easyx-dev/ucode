/**
 * 会话条目里的用户消息 → 编辑器文档：编辑重发复用输入区的编辑器，因此正文里的位置标记要还原成节点。
 *
 * 复用条目解析（`parseEntryText` 的分段，其中已经包含命令与技能的 `args`）与同一批节点构造
 * （`doc-nodes`），这样「编辑重发」与「首次发送」走的是同一条投递口径：文档 → 方言投影 → 载荷。
 *
 * 不复用 `docToDialect`：那条路走的是方言文本，而这里手上是**条目**（含展开块与位置标记），
 * 得先把标记还原成节点。
 */

import { attachmentNode, commandNode, contextNode, type DocNode } from "./doc-nodes.ts";
import type { ParsedEntry } from "./entry.ts";
import { baseName } from "./path.ts";

/**
 * `images` 是本条消息的图片块 id（按出现顺序）：条目正文里图片只有 `图片 N` 标记，
 * 本体在图片块上，按序号取回。取不到（序号越界）就丢掉这个节点——宁可少一张图，
 * 也不发一个指向不存在附件的引用出去。
 */
export const entryToDoc = (parsed: ParsedEntry, images: readonly string[]): DocNode => {
  const paragraphs: DocNode[][] = [[]];
  const current = (): DocNode[] => paragraphs[paragraphs.length - 1] as DocNode[];
  const push = (node: DocNode): void => {
    current().push(node);
  };
  const breakLine = (): void => {
    paragraphs.push([]);
  };

  // 命令 / 技能还原成 mention 节点（命令名之后补一个空格，否则正文里的参数会贴上去）；
  // 参数不在这里补：它已经在 `parsed.segments` 里（命令参数 + 各技能参数 + 块外正文按顺序扫描的
  // 结果），统一按分段还原，参数里的引用 / 图片 / 附件才不会漏
  for (const skill of parsed.skills) {
    push(commandNode(skill.name, "skill"));
    push({ type: "text", text: " " });
  }
  if (parsed.command) {
    push(commandNode(parsed.command.name, "prompt"));
    push({ type: "text", text: " " });
  }

  for (const segment of parsed.segments) {
    if (segment.type === "text") {
      // 换行拆成新段落：文档模型里段落之间就是换行，与方言投影的拼接口径一致
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
