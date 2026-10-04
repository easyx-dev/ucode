/** agent/attachment：内容寻址附件库 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { putAttachment, resolveAttachment } from "../index";

const created: string[] = [];

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "att-test-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("附件库", () => {
  it("内容寻址：同内容只落一份并可按 id 取回", () => {
    const dir = makeTemp();
    const bytes = Buffer.from("hello attachment");

    const first = putAttachment(bytes, "image/png", dir);
    const second = putAttachment(bytes, "image/png", dir);

    assert.equal(first.id, second.id);
    assert.equal(first.path, second.path);
    const resolved = resolveAttachment(first.id, dir);
    assert.equal(resolved?.path, first.path);
    assert.equal(resolved?.mimeType, "image/png");
  });

  it("非法 id 或不存在返回 null", () => {
    const dir = makeTemp();
    assert.equal(resolveAttachment("not-hex", dir), null);
    assert.equal(resolveAttachment("a".repeat(64), dir), null);
  });
});
