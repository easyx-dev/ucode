/**
 * 编辑器里的附件节点视图：正文里就是一枚 token（`图片n` / 文件名，带类型图标）。
 *
 * 图片 token 是原图预览入口（`mousedown` 上拦掉选区变化），文件 token 不拦事件——编辑区点附件只落光标、
 * Backspace 删除，误触不该触发下载；气泡里点附件才是下载。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, useEditorState } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { AttachmentToken } from "../../attachment/attachment-token";
import { openImagePreview } from "../../attachment/image-preview-dialog";
import { attachmentOrdinalInDoc, type ComposerNode } from "../document/composer-document";

/** 节点名；`docToPayload` 与编辑器命令都按它找附件节点 */
export const ATTACHMENT_NODE = "attachmentMention";

export function AttachmentChipView({ node, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const tempId = typeof node.attrs.tempId === "string" ? node.attrs.tempId : "";
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "";
  const kind = node.attrs.kind === "image" ? "image" : "file";
  const key = id || tempId;
  // 序号按文档顺序现算而不是写进 attrs：删掉第一张图，第二张立刻变成 `图片1`
  const ordinal = useEditorState({
    editor,
    selector: ({ editor: target }) =>
      attachmentOrdinalInDoc(target.getJSON() as ComposerNode, key, kind),
  });

  const token = (
    <AttachmentToken kind={kind} index={ordinal ?? 0} name={name || id} pending={!id} />
  );

  return (
    <NodeViewWrapper as="span" className="inline-block align-baseline">
      {kind === "image" && id ? (
        <button
          type="button"
          title={name || t("图片预览")}
          onMouseDown={(event) => {
            event.preventDefault();
            openImagePreview({ alt: name, source: id });
          }}
        >
          {token}
        </button>
      ) : (
        <span title={name}>{token}</span>
      )}
    </NodeViewWrapper>
  );
}
