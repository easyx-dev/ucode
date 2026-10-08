/** 行级 diff 单测：三态行序列、末尾换行归一化与编辑距离闸门 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { diffLines } from "../text-diff";

/** 造 n 行文本，行内容由 `label` 决定 */
const textOf = (count: number, label: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => label(index)).join("\n");

test("相同文本全为未变行", () => {
  assert.deepEqual(diffLines("a\nb\n", "a\nb\n"), [
    { type: "ctx", text: "a" },
    { type: "ctx", text: "b" },
  ]);
});

test("改一行：删除在前、新增在后，其余未变", () => {
  assert.deepEqual(diffLines("a\nb\nc\n", "a\nB\nc\n"), [
    { type: "ctx", text: "a" },
    { type: "del", text: "b" },
    { type: "add", text: "B" },
    { type: "ctx", text: "c" },
  ]);
});

test("新增文件（旧文本为空）全是新增行", () => {
  assert.deepEqual(diffLines("", "a\nb"), [
    { type: "add", text: "a" },
    { type: "add", text: "b" },
  ]);
});

test("两边都为空时没有任何行", () => {
  assert.deepEqual(diffLines("", ""), []);
});

test("末尾换行不额外产生空行", () => {
  assert.equal(diffLines("a\n", "a\n").length, 1);
});

test("只差末尾换行时视为未变，不产生同文本的删 / 增对", () => {
  assert.deepEqual(diffLines("a\nb", "a\nb\n"), [
    { type: "ctx", text: "a" },
    { type: "ctx", text: "b" },
  ]);
});

test("大文件里的小改动仍逐行比对（不因文本规模退化）", () => {
  const before = textOf(3000, (index) => `line-${index}`);
  const after = textOf(3000, (index) => (index === 1500 ? "changed" : `line-${index}`));
  const lines = diffLines(before, after);
  assert.equal(lines.filter((line) => line.type === "add").length, 1);
  assert.equal(lines.filter((line) => line.type === "del").length, 1);
  assert.equal(lines.filter((line) => line.type === "ctx").length, 2999);
});

test("改动量超过编辑距离上限时整块替换", () => {
  const before = textOf(1500, (index) => `old-${index}`);
  const after = textOf(1500, (index) => `new-${index}`);
  const lines = diffLines(before, after);
  assert.equal(lines.length, 3000);
  assert.equal(lines[0]?.type, "del");
  assert.equal(lines[1499]?.type, "del");
  assert.equal(lines[1500]?.type, "add");
  assert.equal(lines[2999]?.type, "add");
});
