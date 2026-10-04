/**
 * /api/v1/attachments：按 id（sha256）返回附件原始字节。
 *
 * 非 JSON、不走封套（同 `/events` 的例外）；`Content-Type` 取自存储时的 mimeType，
 * 带 `Cache-Control: immutable`（内容寻址，内容不会变）与 `ETag`。
 */
import { readFileSync } from "node:fs";

import { Hono } from "hono";

import { resolveAttachment } from "../../agent/attachment";

/** 与附件库的 id 规则一致：64 位小写 hex */
const ID_PATTERN = /^[0-9a-f]{64}$/;

export const createAttachmentsRoute = () => {
  const router = new Hono();

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.body(null, 404);

    const found = resolveAttachment(id);
    if (!found) return c.body(null, 404);

    return c.body(new Uint8Array(readFileSync(found.path)), 200, {
      "content-type": found.mimeType,
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${id}"`,
    });
  });

  return router;
};
