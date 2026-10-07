/** preview：扩展名 → 预览类别、图片 MIME 与体积格式化 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extensionOf, formatBytes, imageMimeOf, previewKindOf } from "../preview";

describe("extensionOf", () => {
  it("取小写扩展名，认不出时给空串", () => {
    assert.equal(extensionOf("/a/b/main.TS"), "ts");
    assert.equal(extensionOf("a.tar.gz"), "gz");
    assert.equal(extensionOf("/a/b/Dockerfile"), "");
    assert.equal(extensionOf("/a/b/.gitignore"), "");
    assert.equal(extensionOf("a."), "");
  });
});

describe("previewKindOf", () => {
  it("图片 / markdown / pdf / 办公文档各归各类", () => {
    assert.equal(previewKindOf("/a/logo.svg"), "image");
    assert.equal(previewKindOf("/a/shot.PNG"), "image");
    assert.equal(previewKindOf("/a/README.md"), "markdown");
    assert.equal(previewKindOf("/a/spec.markdown"), "markdown");
    assert.equal(previewKindOf("/a/manual.pdf"), "pdf");
    assert.equal(previewKindOf("/a/report.docx"), "document");
  });

  it("代码与无扩展名的文件都落到文本桶", () => {
    assert.equal(previewKindOf("/a/main.ts"), "text");
    assert.equal(previewKindOf("/a/Makefile"), "text");
    assert.equal(previewKindOf("/a/unknown.zzz"), "text");
  });
});

describe("imageMimeOf", () => {
  it("按扩展名给 MIME，认不出回落 octet-stream", () => {
    assert.equal(imageMimeOf("/a/x.svg"), "image/svg+xml");
    assert.equal(imageMimeOf("/a/x.webp"), "image/webp");
    assert.equal(imageMimeOf("/a/x.zzz"), "application/octet-stream");
  });
});

describe("formatBytes", () => {
  it("按 B / KB / MB 三档展示", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });
});
