/** 编辑器按键的归属：发送条件、触屏例外与弹层让位 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composerKeyIntentOf } from "../key-intent";

/** 默认是桌面、不在列表、没有 Esc 回调、弹层没开 */
const ctx = (
  patch: Partial<Parameters<typeof composerKeyIntentOf>[1]> = {},
): Parameters<typeof composerKeyIntentOf>[1] => ({
  suggestionOpen: false,
  inList: false,
  escape: false,
  touch: false,
  ...patch,
});

describe("composerKeyIntentOf", () => {
  it("桌面：没有 Shift 的回车是发送", () => {
    assert.equal(composerKeyIntentOf({ key: "Enter" }, ctx()), "send");
  });

  it("Shift+Enter 是换行、组合中的回车是选字：都不发送", () => {
    assert.equal(composerKeyIntentOf({ key: "Enter", shiftKey: true }, ctx()), "pass");
    assert.equal(composerKeyIntentOf({ key: "Enter", isComposing: true }, ctx()), "pass");
  });

  it("触屏：软键盘回车（没有 Shift）是换行，不发送", () => {
    assert.equal(composerKeyIntentOf({ key: "Enter" }, ctx({ touch: true })), "pass");
  });

  it("触屏不影响 Esc 与弹层让位", () => {
    assert.equal(
      composerKeyIntentOf({ key: "Escape" }, ctx({ touch: true, escape: true })),
      "escape",
    );
    assert.equal(
      composerKeyIntentOf({ key: "Enter" }, ctx({ touch: true, suggestionOpen: true })),
      "suggestion",
    );
  });

  it("列表里回车是续行 / 退出列表，退出后再按一次才发送", () => {
    assert.equal(composerKeyIntentOf({ key: "Enter" }, ctx({ inList: true })), "pass");
  });

  it("弹层有候选时导航键归弹层", () => {
    const open = ctx({ suggestionOpen: true });
    for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"]) {
      assert.equal(composerKeyIntentOf({ key }, open), "suggestion", key);
    }
    // 弹层不认识的键照常走下面的判定
    assert.equal(composerKeyIntentOf({ key: "a" }, open), "pass");
  });

  it("Esc 只在有回调时消费", () => {
    assert.equal(composerKeyIntentOf({ key: "Escape" }, ctx({ escape: true })), "escape");
    assert.equal(composerKeyIntentOf({ key: "Escape" }, ctx()), "pass");
  });

  it("其余按键交回编辑器", () => {
    assert.equal(composerKeyIntentOf({ key: "a" }, ctx()), "pass");
    assert.equal(composerKeyIntentOf({ key: "ArrowDown" }, ctx()), "pass");
  });
});
