/**
 * 图片归一化：把客户端上传的 base64 图片经 pi 的 `resizeImage` 压到限内，
 * 入内容寻址附件库，并产出 pi 的 image 内容块（`prompt` / `steer` / `followUp` 直接可收）。
 *
 * 无法归一化（格式不支持、超限且不可压缩）统一抛 `image_invalid`，不把坏图透给模型。
 */
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES, type MessageImageInput } from "@ucode/contracts";

import { IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION } from "../../constants";
import { env } from "../../env";
import { AppError } from "../../lib/response";
import { putAttachment } from "../attachment";

/** pi 的 ImageContent 结构（未从包根导出，按 `session.prompt` 的签名对齐） */
export type PromptImage = { type: "image"; data: string; mimeType: string };

export type NormalizedImage = { id: string; mimeType: string; content: PromptImage };

export const normalizeImages = async (
  images: readonly MessageImageInput[],
  dir = env.attachmentsDir,
): Promise<NormalizedImage[]> => {
  const normalized: NormalizedImage[] = [];
  for (const image of images) {
    const resized = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType, {
      maxWidth: IMAGE_MAX_DIMENSION,
      maxHeight: IMAGE_MAX_DIMENSION,
      maxBytes: IMAGE_MAX_BYTES,
    });
    if (!resized) {
      throw new AppError(ERROR_CODES.imageInvalid, "图片无法归一化", 400, undefined, {
        reason: image.mimeType,
      });
    }
    const { id } = putAttachment(Buffer.from(resized.data, "base64"), resized.mimeType, dir);
    normalized.push({
      id,
      mimeType: resized.mimeType,
      content: { type: "image", data: resized.data, mimeType: resized.mimeType },
    });
  }
  return normalized;
};
