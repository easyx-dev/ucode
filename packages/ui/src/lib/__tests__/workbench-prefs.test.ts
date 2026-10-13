/** workbench-prefs：工作台显隐按键记忆（按项目分键、无项目回落全局） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brand } from "@ucode/brand/values";

import {
  readWorkbenchOpen,
  workbenchGlobalKey,
  workbenchOpenKeyOf,
  writeWorkbenchOpen,
} from "../workbench-prefs";

describe("workbenchOpenKeyOf", () => {
  it("有项目时在全局键后面接项目 id", () => {
    assert.equal(workbenchOpenKeyOf("p1"), `${brand.slug}-workbench-open:p1`);
  });

  it("没有项目时用全局键（草稿态与助理工作区都走这条）", () => {
    assert.equal(workbenchOpenKeyOf(null), workbenchGlobalKey());
    assert.equal(workbenchOpenKeyOf(null), `${brand.slug}-workbench-open`);
  });
});

describe("读写", () => {
  it("没有 localStorage 的环境下读回落收起、写不抛错", () => {
    // node 里没有 window，`lib/storage` 的 try/catch 兜住：读回落 false，写当无事发生
    assert.equal(readWorkbenchOpen("p1"), false);
    assert.doesNotThrow(() => writeWorkbenchOpen("p1", true));
  });
});
