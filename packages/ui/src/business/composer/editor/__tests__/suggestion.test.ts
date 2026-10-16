/** 建议弹层的按键判定：换行与输入法组合不能被当成「选中当前项」 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestionKeyActionOf } from "../suggestion";

describe("suggestionKeyActionOf", () => {
  it("方向键、Tab 与 Enter 归弹层", () => {
    assert.equal(suggestionKeyActionOf({ key: "ArrowDown" }, 3), "next");
    assert.equal(suggestionKeyActionOf({ key: "ArrowUp" }, 3), "previous");
    assert.equal(suggestionKeyActionOf({ key: "Tab" }, 3), "select");
    assert.equal(suggestionKeyActionOf({ key: "Enter" }, 3), "select");
  });

  it("Shift+Enter 是换行、组合中的 Enter 是选字：都交回编辑器", () => {
    assert.equal(suggestionKeyActionOf({ key: "Enter", shiftKey: true }, 3), "pass");
    assert.equal(suggestionKeyActionOf({ key: "Enter", isComposing: true }, 3), "pass");
  });

  it("Esc 关菜单；没有候选时什么都不消费", () => {
    assert.equal(suggestionKeyActionOf({ key: "Escape" }, 3), "dismiss");
    assert.equal(suggestionKeyActionOf({ key: "Enter" }, 0), "pass");
    assert.equal(suggestionKeyActionOf({ key: "ArrowDown" }, 0), "pass");
  });
});
