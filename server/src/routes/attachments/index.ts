/**
 * /api/v1/attachments：附件上传与按 id 取回。
 *
 * - `POST /`：请求体是原始字节（非 JSON），`Content-Type` 为附件类型，文件名走 `?name=`。
 *   图片经 pi 归一化后入库，其它原样入库；返回 `AttachmentView`。
 * - `GET /:id`：按 id（sha256）返回原始字节，非 JSON、不走封套（同 `/events` 的例外），
 *   带 `Cache-Control: immutable`（内容寻址，内容不会变）与 `ETag`。
 */
import { readFileSync } from "node:fs";

import {
  ATTACHMENT_MAX_UPLOAD_BYTES,
  type AttachmentView,
  ERROR_CODES,
  IMAGE_MIME_TYPES,
} from "@ucode/contracts";
import { Hono } from "hono";

import { isAttachmentId, putAttachment, resolveAttachment } from "../../harness/attachment";
import { storeImage } from "../../harness/image";
import type { Services } from "../../app";
import { AppError, ok } from "../../lib/response";

const isImageMime = (value: string): boolean =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(value);

const kindOf = (mimeType: string): AttachmentView["kind"] =>
  mimeType.startsWith("image/") ? "image" : "file";

const toView = (record: {
  id: string;
  mimeType: string;
  name: string | null;
  size: number;
}): AttachmentView => ({
  id: record.id,
  mimeType: record.mimeType,
  name: record.name,
  size: record.size,
  kind: kindOf(record.mimeType),
});

const tooLarge = (): AppError =>
  new AppError(ERROR_CODES.payloadTooLarge, "附件超过大小上限", 413, undefined, {
    max: `${Math.floor(ATTACHMENT_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
  });

export const createAttachmentsRoute = (services: Services) => {
  const router = new Hono();
  const deps = { repo: services.attachments };

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!isAttachmentId(id)) return c.body(null, 404);

    const found = resolveAttachment(id, deps);
    if (!found) return c.body(null, 404);

    return c.body(new Uint8Array(readFileSync(found.path)), 200, {
      "content-type": found.mimeType,
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${id}"`,
    });
  });

  router.post("/", async (c) => {
    // 先按声明长度挡一道，避免超大请求体被完整读进内存；读完再兜一次
    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > ATTACHMENT_MAX_UPLOAD_BYTES) {
      throw tooLarge();
    }

    // 只取 media type，忽略 charset 等参数；缺省按二进制流处理
    const mimeType =
      (c.req.header("content-type") ?? "").split(";")[0]?.trim() || "application/octet-stream";
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) {
      throw new AppError(ERROR_CODES.invalidRequest, "上传内容为空", 400);
    }
    if (bytes.length > ATTACHMENT_MAX_UPLOAD_BYTES) {
      throw tooLarge();
    }

    const name = c.req.query("name")?.trim() || null;
    const record = isImageMime(mimeType)
      ? await storeImage(bytes, mimeType, name, deps)
      : putAttachment(bytes, { mimeType, name }, deps);
    return c.json(ok(toView(record)));
  });

  return router;
};
