/**
 * 图片附件的客户端预压缩与编码。
 *
 * 粘贴 / 拖拽进来的原始图片先在这里压一遍再入库，避免把大图直接塞进请求：
 * 最长边对齐服务端归一化的 2000px，字节上限由契约的 base64 上限反推（base64 约为原始字节的 4/3）。
 */
import { MESSAGE_IMAGE_MAX_BASE64_BYTES } from "@ucode/contracts";

/** 与服务端 `IMAGE_MAX_DIMENSION` 保持一致 */
const MAX_DIMENSION = 2000;

/** base64 上限换算回原始字节，再留出编码余量 */
const MAX_BYTES = Math.floor((MESSAGE_IMAGE_MAX_BASE64_BYTES * 3) / 4) - 64 * 1024;

/** 输出格式：png / gif 保留无损与透明，webp 原样，其余统一转 jpeg（体积更小） */
const outputTypeOf = (sourceType: string): string => {
  if (sourceType === "image/png" || sourceType === "image/gif") return "image/png";
  if (sourceType === "image/webp") return "image/webp";
  return "image/jpeg";
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * 压缩一张图片：尺寸已在限内且体积达标时原样返回（保留 gif 动画），
 * 否则缩放后按质量逐档重编码，直到落入字节上限。
 */
export const compressImage = async (file: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_BYTES) return file;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const type = outputTypeOf(file.type);
    let blob = (await toBlob(canvas, type, 0.9)) ?? file;
    for (let quality = 0.8; blob.size > MAX_BYTES && quality >= 0.3; quality -= 0.1) {
      blob = (await toBlob(canvas, type, quality)) ?? blob;
    }
    return blob;
  } finally {
    bitmap.close();
  }
};

/** Blob → 纯 base64（不含 `data:` 前缀），分块拼接避免超长参数栈溢出 */
export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};
