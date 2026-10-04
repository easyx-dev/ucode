/**
 * 图片归一化：上传的图片经 pi `resizeImage` 压到限内后入内容寻址附件库；
 * 发送时按附件 id 读回**入库时的字节**再 base64，转成 pi 的 image 内容块。
 *
 * 无法归一化（格式不支持、超限且不可压缩）统一抛 `image_invalid`，不把坏图透给模型。
 */
import { readFileSync } from "node:fs";

import { resizeImage } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES } from "@ucode/contracts";

import { IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION } from "../../constants";
import type { AttachmentRecord } from "../../db/attachment-repository";
import { AppError } from "../../lib/response";
import { type AttachmentDeps, putAttachment, type ResolvedAttachment } from "../attachment";

/** pi 的 ImageContent 结构（未从包根导出，按 `session.prompt` 的签名对齐） */
export type PromptImage = { type: "image"; data: string; mimeType: string };

/** 归一化并入库单张图片；返回入库后的附件记录 */
export const storeImage = async (
  bytes: Uint8Array,
  mimeType: string,
  name: string | null,
  deps: AttachmentDeps,
): Promise<AttachmentRecord> => {
  const resized = await resizeImage(Buffer.from(bytes), mimeType, {
    maxWidth: IMAGE_MAX_DIMENSION,
    maxHeight: IMAGE_MAX_DIMENSION,
    maxBytes: IMAGE_MAX_BYTES,
  });
  if (!resized) {
    throw new AppError(ERROR_CODES.imageInvalid, "图片无法归一化", 400, undefined, {
      reason: mimeType,
    });
  }
  return putAttachment(
    Buffer.from(resized.data, "base64"),
    { mimeType: resized.mimeType, name },
    deps,
  );
};

/** 附件 → pi 的 image 内容块：按 id 读回库里的字节，保证与 JSONL 里的内容一致 */
export const toPromptImage = (attachment: ResolvedAttachment): PromptImage => ({
  type: "image",
  data: readFileSync(attachment.path).toString("base64"),
  mimeType: attachment.mimeType,
});
