/** harness/image：图片归一化与转 pi 内容块 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { openDatabase } from "../../../db";
import { AttachmentRepository } from "../../../db/attachment-repository";
import { resolveAttachment } from "../../attachment";
import { storeImage, toPromptImage } from "../index";

const created: string[] = [];

/** 2x2 RGB PNG，用作可解码的最小样本（Photon 对部分 1x1 灰度 PNG 会 panic） */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGhgZGhgYGBsYGRsAAAMIgIFOxfAbgAAAABJRU5ErkJggg==";

const makeEnv = () => {
  const root = mkdtempSync(join(tmpdir(), "img-test-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return {
    dir: join(root, "attachments"),
    repo: new AttachmentRepository(db),
    close: () => db.close(),
  };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("storeImage", () => {
  it("合法图片归一化后入附件库，并可转成 pi 内容块", async () => {
    const env = makeEnv();
    try {
      const record = await storeImage(
        Buffer.from(TINY_PNG, "base64"),
        "image/png",
        "tiny.png",
        env,
      );
      assert.equal(record.mimeType, "image/png");
      assert.equal(record.name, "tiny.png");

      const resolved = resolveAttachment(record.id, env);
      assert.ok(resolved);
      const content = toPromptImage(resolved);
      assert.equal(content.type, "image");
      assert.equal(content.mimeType, "image/png");
      assert.ok(content.data.length > 0);
    } finally {
      env.close();
    }
  });

  it("坏图片抛 image_invalid", async () => {
    const env = makeEnv();
    try {
      await assert.rejects(
        () => storeImage(Buffer.from("definitely not an image"), "image/png", null, env),
        /图片无法归一化/,
      );
    } finally {
      env.close();
    }
  });
});
