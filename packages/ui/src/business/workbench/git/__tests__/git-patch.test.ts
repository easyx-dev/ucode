/** git-patch：结构化 hunk 还原成 patch 文本（交给 diff 视图库解析） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitHunk } from "@ucode/contracts";

import { hunkPatchText } from "../git-patch";

describe("hunkPatchText", () => {
  it("带上文件头，hunk 头部原样，行按新增 / 删除 / 上下文加前缀", () => {
    const hunks: GitHunk[] = [
      {
        header: "@@ -1,2 +1,3 @@",
        lines: [
          { kind: "ctx", oldLine: 1, newLine: 1, text: "keep" },
          { kind: "del", oldLine: 2, newLine: null, text: "old" },
          { kind: "add", oldLine: null, newLine: 2, text: "new" },
          { kind: "add", oldLine: null, newLine: 3, text: "" },
        ],
      },
    ];

    assert.equal(
      hunkPatchText("src/a.ts", hunks),
      ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+"].join(
        "\n",
      ),
    );
  });

  it("多个 hunk 顺序拼在同一段里", () => {
    const hunks: GitHunk[] = [
      { header: "@@ -1 +1 @@", lines: [{ kind: "ctx", oldLine: 1, newLine: 1, text: "a" }] },
      { header: "@@ -9 +9 @@", lines: [{ kind: "ctx", oldLine: 9, newLine: 9, text: "b" }] },
    ];

    const text = hunkPatchText("b.txt", hunks);
    assert.deepEqual(
      text.split("\n").filter((line) => line.startsWith("@@ ")),
      ["@@ -1 +1 @@", "@@ -9 +9 @@"],
    );
  });

  it("没有 hunk 时只有文件头", () => {
    assert.equal(hunkPatchText("x", []), ["--- a/x", "+++ b/x"].join("\n"));
  });
});
