/**
 * 编辑器里的附件 chip（Tiptap 节点视图）：图片显缩略图、其余显图标与文件名，上传中是占位。
 *
 * 只有图片的缩略图那一截是预览命中区（`mousedown` 上拦掉选区变化），其余区域仍是原子节点——
 * 点一下把光标落在 chip 上、Backspace 删除，与其它 mention 一致。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { FileText } from "lucide-react";

import { AttachmentThumb, useAttachmentPreview } from "../attachment-preview";

/** 节点名；`docToPayload` 与编辑器命令都按它找附件节点 */
export const ATTACHMENT_NODE = "attachmentMention";

const CHIP_CLASS =
  "inline-flex max-w-48 items-center gap-1 rounded bg-muted px-1 py-0.5 align-baseline text-foreground";

export function AttachmentChipView({ node }: NodeViewProps) {
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "";
  const isImage = node.attrs.kind === "image";
  const { open, dialog } = useAttachmentPreview();

  return (
    <NodeViewWrapper as="span" className={CHIP_CLASS}>
      {isImage ? (
        id ? (
          <button
            type="button"
            title={name}
            className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm"
            onMouseDown={(event) => {
              // 拦下选区变化：缩略图是预览入口，不是落光标的地方
              event.preventDefault();
              open({ id, name });
            }}
          >
            <AttachmentThumb id={id} className="size-4 object-cover" />
          </button>
        ) : (
          <span className="size-4 shrink-0 animate-pulse rounded-sm bg-foreground/20" />
        )
      ) : (
        <>
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{name || id}</span>
        </>
      )}
      {dialog}
    </NodeViewWrapper>
  );
}
