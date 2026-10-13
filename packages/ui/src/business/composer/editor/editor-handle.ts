/**
 * 编辑器的命令式句柄：收回焦点，以及附件节点的插入 / 落定 / 丢弃与计数。
 *
 * 附件的读写按 **`tempId` 找节点**而不是记位置——上传在途期间用户还会继续打字、删字，
 * 位置会漂；`tempId` 只由 `useComposerAttachments` 生成，稳定且唯一。
 */
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AttachmentView } from "@ucode/contracts";
import { commandNode, type MentionKind } from "../document/composer-document";
import { ATTACHMENT_NODE } from "./attachment-chip";

/** 命令 / 技能节点名；与 `extensions.ts` 的节点定义同名 */
const COMMAND_NODE = "commandMention";

export type ComposerEditorHandle = {
  focus: () => void;
  /** 插入上传中的附件占位（多个一次插完，顺序即文件顺序） */
  insertAttachments: (
    items: readonly { tempId: string; name: string; kind: AttachmentView["kind"] }[],
  ) => void;
  /** 上传完成：按 `tempId` 就地补上 id 与归一化后的名字 */
  resolveAttachment: (tempId: string, attachment: Pick<AttachmentView, "id" | "name">) => void;
  /** 上传失败：按 `tempId` 移除占位 */
  dropAttachment: (tempId: string) => void;
  /** 当前附件节点数（含上传中的占位），用于数上限 */
  attachmentCount: () => number;
  /** 在正文开头插入命令 / 技能节点；开头已有一条时返回 false（命令只能整条匹配，再插一条会作废） */
  insertCommand: (command: { kind: MentionKind; name: string }) => boolean;
};

const findAttachment = (
  doc: ProseMirrorNode,
  tempId: string,
): { pos: number; node: ProseMirrorNode } | null => {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== ATTACHMENT_NODE || node.attrs.tempId !== tempId) return true;
    found = { pos, node };
    return false;
  });
  return found;
};

const countAttachments = (doc: ProseMirrorNode): number => {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === ATTACHMENT_NODE) count += 1;
    return true;
  });
  return count;
};

/** 正文开头（首个非空段的首个节点）是否已经是命令 / 技能节点 */
const startsWithCommand = (doc: ProseMirrorNode): boolean =>
  doc.firstChild?.firstChild?.type.name === COMMAND_NODE;

/** `getEditor` 读的是组件的编辑器 ref：句柄在外部长期持有，不能捕获实例 */
export const createEditorHandle = (getEditor: () => Editor | null): ComposerEditorHandle => ({
  focus: () => {
    getEditor()?.commands.focus("end");
  },
  insertAttachments: (items) => {
    const editor = getEditor();
    if (!editor || items.length === 0) return;
    editor
      .chain()
      .focus()
      .insertContent(
        items.flatMap((item) => [
          {
            type: ATTACHMENT_NODE,
            attrs: { id: null, name: item.name, kind: item.kind, tempId: item.tempId },
          },
          { type: "text", text: " " },
        ]),
      )
      .run();
  },
  resolveAttachment: (tempId, attachment) => {
    const editor = getEditor();
    const found = editor ? findAttachment(editor.state.doc, tempId) : null;
    if (!editor || !found) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        id: attachment.id,
        name: attachment.name,
        tempId: null,
      }),
    );
  },
  dropAttachment: (tempId) => {
    const editor = getEditor();
    const found = editor ? findAttachment(editor.state.doc, tempId) : null;
    if (!editor || !found) return;
    editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
  },
  attachmentCount: () => {
    const editor = getEditor();
    return editor ? countAttachments(editor.state.doc) : 0;
  },
  insertCommand: (command) => {
    const editor = getEditor();
    if (!editor || startsWithCommand(editor.state.doc)) return false;
    // 参数写在节点之后（与 `/goal` 的「命令名 + 参数」语义一致），光标落到末尾接着打
    editor
      .chain()
      .insertContentAt(1, [commandNode(command.name, command.kind), { type: "text", text: " " }])
      .focus("end")
      .run();
    return true;
  },
});
