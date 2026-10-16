/** patch 文本单测：hunk 头与行、末尾换行归一化、编辑距离闸门与多片段拼接 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toTextPatch } from "../text-diff";

/** 造 n 行文本，行内容由 `label` 决定 */
const textOf = (count: number, label: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => label(index)).join("\n");

/** 取 patch 里每个 hunk 的正文（去掉文件头与 hunk 头） */
const bodyOf = (patch: string): string[] =>
  patch.split("\n").filter((line) => line.startsWith(" ") || /^[+-][^+-]/.test(line));

test("相同文本没有差异：patch 为空，两侧原文原样带回", () => {
  assert.deepEqual(toTextPatch("a.ts", [{ oldText: "a\nb\n", newText: "a\nb\n" }]), {
    oldContent: "a\nb\n",
    newContent: "a\nb\n",
    patch: "",
  });
});

test("改一行：文件头齐全，未变行留在 hunk 里做上下文", () => {
  const { patch } = toTextPatch("src/a.ts", [{ oldText: "a\nb\nc", newText: "a\nB\nc" }]);
  assert.equal(
    patch.trimEnd(),
    ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
  );
});

test("新增（旧侧为空）：hunk 头从 0 行起，全是新增行", () => {
  const { patch } = toTextPatch("a.ts", [{ oldText: "", newText: "第一行\n第二行" }]);
  assert.equal(
    patch.trimEnd(),
    ["--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1,2 @@", "+第一行", "+第二行"].join("\n"),
  );
});

test("末尾换行归一化：只差末尾换行视为无差异，也不给末行贴 no-newline 标记", () => {
  assert.equal(toTextPatch("a.ts", [{ oldText: "a\nb", newText: "a\nb\n" }]).patch, "");
  // 两侧都没有末尾换行时同样归一，patch 里不出现转义标记
  const { patch } = toTextPatch("a.ts", [{ oldText: "a", newText: "b" }]);
  assert.equal(patch.includes("\\ No newline"), false);
});

test("多处改动拼成一段文本：片段之间带着上下文行，只有一个 hunk", () => {
  const { oldContent, newContent, patch } = toTextPatch("a.ts", [
    { oldText: "甲\n乙", newText: "甲新\n乙" },
    { oldText: "丙", newText: "丙新" },
  ]);
  assert.equal(oldContent, "甲\n乙\n丙\n");
  assert.equal(newContent, "甲新\n乙\n丙新\n");
  assert.deepEqual(bodyOf(patch), ["-甲", "+甲新", " 乙", "-丙", "+丙新"]);
  assert.equal(patch.match(/^@@/gm)?.length, 1);
});

test("大文件里的小改动仍逐行比对，hunk 头带真实行号", () => {
  const before = textOf(3000, (index) => `line-${index}`);
  const after = textOf(3000, (index) => (index === 1500 ? "changed" : `line-${index}`));
  const { patch } = toTextPatch("a.ts", [{ oldText: before, newText: after }]);
  // 改动那一行前后各 3 行上下文：hunk 从第 1498 行起、共 7 行
  assert.equal(patch.includes("@@ -1498,7 +1498,7 @@"), true);
  assert.deepEqual(bodyOf(patch).slice(0, 4), [
    " line-1497",
    " line-1498",
    " line-1499",
    "-line-1500",
  ]);
});

test("改动量超过编辑距离上限时整块替换：先全删、再全增，没有上下文行", () => {
  const before = textOf(1500, (index) => `old-${index}`);
  const after = textOf(1500, (index) => `new-${index}`);
  const { patch } = toTextPatch("a.ts", [{ oldText: before, newText: after }]);
  assert.equal(patch.includes("@@ -1,1500 +1,1500 @@"), true);
  const body = bodyOf(patch);
  assert.equal(body.length, 3000);
  assert.equal(body[0], "-old-0");
  assert.equal(body[1499], "-old-1499");
  assert.equal(body[1500], "+new-0");
  assert.equal(body[2999], "+new-1499");
});

test("整篇重写（旧侧为空、新侧远超闸门）也走整块替换，不会没有 patch", () => {
  const content = textOf(2000, (index) => `line-${index}`);
  const { patch } = toTextPatch("a.ts", [{ oldText: "", newText: content }]);
  assert.equal(patch.includes("@@ -0,0 +1,2000 @@"), true);
  assert.equal(bodyOf(patch).length, 2000);
});
