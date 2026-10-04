/**
 * 内容寻址附件库：按 sha256 存原始字节，图片与文档共用。
 *
 * 存 `<sha256>.<ext>`；`id` 就是 sha256，天然去重。字节路由按 id 找回并带上
 * 存储时的 mimeType（未知类型落成 `.bin`）。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { env } from "../../env";

/** 附件 id：64 位小写 hex（sha256） */
const ID_PATTERN = /^[0-9a-f]{64}$/;

/** 允许的附件类型：扩展名与 mimeType 一一对应；未知类型按 `bin` 落盘 */
const ATTACHMENT_TYPES = [
  { ext: "png", mimeType: "image/png" },
  { ext: "jpg", mimeType: "image/jpeg" },
  { ext: "webp", mimeType: "image/webp" },
  { ext: "gif", mimeType: "image/gif" },
  { ext: "bin", mimeType: "application/octet-stream" },
] as const;

export type StoredAttachment = { id: string; path: string };

export type ResolvedAttachment = { path: string; mimeType: string };

export const attachmentIdOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const extFor = (mimeType: string): string =>
  ATTACHMENT_TYPES.find((type) => type.mimeType === mimeType)?.ext ?? "bin";

/** 写入附件库；同内容已存在则跳过（内容寻址天然去重） */
export const putAttachment = (
  bytes: Uint8Array,
  mimeType: string,
  dir = env.attachmentsDir,
): StoredAttachment => {
  mkdirSync(dir, { recursive: true });
  const id = attachmentIdOf(bytes);
  const path = join(dir, `${id}.${extFor(mimeType)}`);
  if (!existsSync(path)) writeFileSync(path, bytes);
  return { id, path };
};

/** 按 id 找回附件；非法 id 或不存在返回 null */
export const resolveAttachment = (
  id: string,
  dir = env.attachmentsDir,
): ResolvedAttachment | null => {
  if (!ID_PATTERN.test(id)) return null;
  for (const type of ATTACHMENT_TYPES) {
    const path = join(dir, `${id}.${type.ext}`);
    if (existsSync(path)) return { path, mimeType: type.mimeType };
  }
  return null;
};
