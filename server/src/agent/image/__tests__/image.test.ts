/** agent/image：图片归一化 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { resolveAttachment } from "../../attachment";
import { normalizeImages } from "../index";

const created: string[] = [];

/** 2x2 RGB PNG，用作可解码的最小样本（Photon 对部分 1x1 灰度 PNG 会 panic） */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGhgZGhgYGBsYGRsAAAMIgIFOxfAbgAAAABJRU5ErkJggg==";

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "img-test-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("normalizeImages", () => {
  it("合法图片归一化后入附件库", async () => {
    const dir = makeTemp();
    const [image] = await normalizeImages([{ data: TINY_PNG, mimeType: "image/png" }], dir);

    assert.ok(image);
    assert.equal(image.content.type, "image");
    assert.equal(image.mimeType, "image/png");
    assert.ok(resolveAttachment(image.id, dir));
  });

  it("坏图片抛 image_invalid", async () => {
    const dir = makeTemp();
    const garbage = Buffer.from("definitely not an image").toString("base64");

    await assert.rejects(
      () => normalizeImages([{ data: garbage, mimeType: "image/png" }], dir),
      /图片无法归一化/,
    );
  });
});
