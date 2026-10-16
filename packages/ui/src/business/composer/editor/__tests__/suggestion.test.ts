/** 建议弹层的按键判定与选中项移动：换行与输入法组合不能被当成「选中当前项」 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stepIndex, suggestionKeyActionOf } from "../suggestion";

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

describe("stepIndex", () => {
  it("头尾都回绕：从最后一条再往下回到第一条，从第一条往上到最后一条", () => {
    assert.equal(stepIndex(0, 1, 45), 1);
    assert.equal(stepIndex(44, 1, 45), 0);
    assert.equal(stepIndex(0, -1, 45), 44);
    assert.equal(stepIndex(3, -1, 45), 2);
  });

  it("没有候选时停在 0，不越位", () => {
    assert.equal(stepIndex(0, 1, 0), 0);
    assert.equal(stepIndex(0, -1, 0), 0);
  });
});
