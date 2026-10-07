/** file-content：文本 / 二进制判定、内联体积上限与截断 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { FS_READ_TEXT_MAX_BYTES } from "../../../constants";
import { readFileContent } from "..";

describe("readFileContent", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "file-content-test-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string | Buffer): string => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it("文本按 UTF-8 内联，不带 base64", () => {
    const path = write("a.ts", "const a = 1;\n");
    const result = readFileContent({ path });
    assert.equal(result.kind, "text");
    assert.equal(result.text, "const a = 1;\n");
    assert.equal(result.base64, undefined);
    assert.equal(result.name, "a.ts");
    assert.equal(result.truncated, false);
  });

  it("含 NUL 的内容判为二进制，给 base64", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d]);
    const path = write("a.png", bytes);
    const result = readFileContent({ path });
    assert.equal(result.kind, "binary");
    assert.equal(result.text, undefined);
    assert.equal(result.base64, bytes.toString("base64"));
    assert.equal(result.truncated, false);
  });

  it("文本超过上限时按上限截断并标注", () => {
    const long = "x".repeat(FS_READ_TEXT_MAX_BYTES + 10);
    const path = write("long.txt", long);
    const result = readFileContent({ path });
    assert.equal(result.kind, "text");
    assert.equal(result.truncated, true);
    assert.equal(result.text?.length, FS_READ_TEXT_MAX_BYTES);
  });

  it("`maxBytes` 让调用方自己收窄内联体积", () => {
    const path = write("mid.txt", "y".repeat(100));
    const result = readFileContent({ path, maxBytes: 10 });
    assert.equal(result.text, "y".repeat(10));
    assert.equal(result.truncated, true);
  });

  it("目录报 not_a_file，不存在的路径报 path_not_found", () => {
    assert.throws(() => readFileContent({ path: dir }), /不是普通文件/);
    assert.throws(() => readFileContent({ path: join(dir, "nope.txt") }), /路径不存在/);
  });
});
