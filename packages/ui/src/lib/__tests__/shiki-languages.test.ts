/** shiki-languages：扩展名 / 别名 → 语言 id 的推断与高亮阈值 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  languageOfPath,
  resolveLanguageId,
  shouldHighlight,
} from "../shiki-languages";

describe("languageOfPath", () => {
  it("按扩展名给语言 id，认不出返回 null", () => {
    assert.equal(languageOfPath("/a/main.ts"), "typescript");
    assert.equal(languageOfPath("/a/App.TSX"), "tsx");
    assert.equal(languageOfPath("/a/script.sh"), "bash");
    assert.equal(languageOfPath("/a/data.yml"), "yaml");
    assert.equal(languageOfPath("/a/notes.unknown"), null);
    assert.equal(languageOfPath("/a/noext"), null);
  });

  it("无扩展名的约定文件名也能认出", () => {
    assert.equal(languageOfPath("/a/Dockerfile"), "docker");
    assert.equal(languageOfPath("/a/Makefile"), "make");
  });
});

describe("resolveLanguageId", () => {
  it("常见短名与 `c++` 这类别名都归一", () => {
    assert.equal(resolveLanguageId("ts"), "typescript");
    assert.equal(resolveLanguageId("JS"), "javascript");
    assert.equal(resolveLanguageId("c++"), "cpp");
    assert.equal(resolveLanguageId("console"), "bash");
    assert.equal(resolveLanguageId("typescript"), "typescript");
  });

  it("空值与语言表外的名字返回 null（渲染器据此铺纯文本）", () => {
    assert.equal(resolveLanguageId(null), null);
    assert.equal(resolveLanguageId("  "), null);
    assert.equal(resolveLanguageId("brainfuck"), null);
  });
});

describe("shouldHighlight", () => {
  it("在阈值内为真，超长或没有语言为假", () => {
    assert.equal(shouldHighlight("const a = 1", "typescript"), true);
    assert.equal(shouldHighlight("const a = 1", null), false);
    assert.equal(shouldHighlight("x".repeat(HIGHLIGHT_MAX_CHARS + 1), "typescript"), false);
    assert.equal(shouldHighlight(`${"\n".repeat(HIGHLIGHT_MAX_LINES)}\n`, "typescript"), false);
  });
});
