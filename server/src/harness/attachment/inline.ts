/**
 * 附件在正文里的内联展开：把正文里的位置标记换成模型能读的形态。
 *
 * 编辑器在正文里留 `图片 N` / `附件 N.<ext>`（见 `@ucode/contracts` 的 markers）；服务端按标记
 * 就地展开非图片附件（换成引用行 `[附件: <显示名> (id: <sha256>)]`），图片标记原样留着——
 * 图片本体只能按顺序附在文本之后（pi 的 `prompt(text, images)` 只接受「一整段文本 + 图片数组」）。
 *
 * 标记与附件列表对不上时返回 null，由调用方退回「引用行前置 + 图片按原顺序」的老路径：
 * 用户手打了同名标记、或附件被删掉一个，都不该让服务端去改用户写的话。
 */
import {
  attachmentRefLine,
  type MarkerTarget,
  markersMatchAttachments,
  scanAttachmentMarkers,
} from "@ucode/contracts";

/** 内联展开要的两侧信息：正文里的图片数，以及非图片附件（载荷顺序） */
export type InlineAttachmentInput = {
  /** 正文里的图片数（`图片 1..K` 的 K 要对上） */
  imageCount: number;
  /** 非图片附件：扩展名用于校验标记，`id`/`name` 用于生成引用行 */
  files: readonly { id: string; name: string | null }[];
};

export const inlineAttachmentText = (text: string, input: InlineAttachmentInput): string | null => {
  const hits = scanAttachmentMarkers(text);
  const targets: MarkerTarget[] = [
    ...Array.from({ length: input.imageCount }, () => ({ kind: "image" as const, name: null })),
    ...input.files.map((file) => ({ kind: "file" as const, name: file.name })),
  ];
  if (!markersMatchAttachments(hits, targets)) return null;

  // 从后往前替换：前面的命中位置不会因为后面的文本变长而偏移
  let out = text;
  for (const hit of hits.filter((item) => item.kind === "file").reverse()) {
    const file = input.files[hit.index - 1];
    if (!file) return null;
    out =
      out.slice(0, hit.from) + attachmentRefLine(file.name ?? file.id, file.id) + out.slice(hit.to);
  }
  return out;
};
