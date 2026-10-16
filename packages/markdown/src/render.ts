/**
 * 载荷 → 方言：把标记形态还原成 `@路径#L1-L2`、`![](attachment:类型/id)` 与容器围栏。
 *
 * 用它把「编辑重发」要改的那条消息还原成用户当初能读能改的写法；附件类型与显示名来自调用方给的
 * 附件视图（载荷里只有 id），因此 `attachments` 的顺序必须与载荷一致。
 */
import { contextMarker, scanAttachmentMarkers } from "@ucode/contracts";
import { guardFences } from "./document.ts";
import type { DialectAttachmentKind, DialectAttachmentView, DialectDocument } from "./types.ts";

const lineSuffixOf = (path: string, doc: DialectDocument): string => {
  const ref = doc.contexts.find((item) => item.path === path);
  if (!ref?.startLine) return "";
  return ref.endLine ? `#L${ref.startLine}-L${ref.endLine}` : `#L${ref.startLine}`;
};

/** 路径含空白时用 `@[显示名](路径)`，否则裸写法 */
const contextToDialect = (path: string, doc: DialectDocument): string => {
  const suffix = lineSuffixOf(path, doc);
  return /[ \t]/.test(path) ? `@[${path}](${path}${suffix})` : `${contextMarker(path)}${suffix}`;
};

const attachmentToDialect = (
  id: string,
  kind: DialectAttachmentKind,
  name: string | null,
): string => {
  const label = name && kind !== "image" ? name : "";
  return `![${label}](attachment:${kind}/${id})`;
};

/** 标记形态的文本 → 方言文本：附件按类型各自编号，引用按 `contexts` 里的行范围补回后缀 */
const textToDialect = (
  text: string,
  doc: DialectDocument,
  views: readonly DialectAttachmentView[],
): string => {
  const images = views.filter((view) => view.kind === "image");
  const files = views.filter((view) => view.kind !== "image");

  // 附件按标记的位置换（下标取自原文，所以先做这一步）；引用是整串替换，放在后面不受影响
  let result = text;
  for (const hit of scanAttachmentMarkers(text).reverse()) {
    const view = hit.kind === "image" ? images[hit.index - 1] : files[hit.index - 1];
    if (!view) continue;
    const dialect = attachmentToDialect(view.id, view.kind, view.name);
    result = result.slice(0, hit.from) + dialect + result.slice(hit.to);
  }
  // 长路径先替换：`@a/b` 不能被 `@a` 的替换切断
  for (const context of [...doc.contexts].sort((a, b) => b.path.length - a.path.length)) {
    result = result.replaceAll(contextMarker(context.path), contextToDialect(context.path, doc));
  }
  return result;
};

/** 容器参数里的行首 `:::` 必须先转义：否则拼出来的围栏会提前闭合，往返一读就错位 */
const container = (kind: "command" | "skill", name: string, args: string): string =>
  args ? `:::${kind}[${name}]\n${guardFences(args)}\n:::` : `:::${kind}[${name}]\n:::`;

export const renderDialect = (
  doc: DialectDocument,
  views: readonly DialectAttachmentView[],
): string => {
  const blocks: string[] = [];
  if (doc.command)
    blocks.push(
      container("command", doc.command.name, textToDialect(doc.command.args, doc, views)),
    );
  for (const skill of doc.skills) {
    blocks.push(container("skill", skill.name, textToDialect(skill.args, doc, views)));
  }
  const prose = textToDialect(doc.text, doc, views);
  if (prose) blocks.push(prose);
  return blocks.join("\n\n");
};
