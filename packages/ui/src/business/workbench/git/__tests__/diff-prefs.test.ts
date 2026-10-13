/** diff-prefs：diff 视图的展示偏好（默认双栏、不换行，只认认识的存量值） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DIFF_MODE, DEFAULT_DIFF_WRAP, diffModeOf, diffWrapOf } from "../diff-prefs";

describe("diffModeOf", () => {
  it("默认双栏", () => {
    assert.equal(DEFAULT_DIFF_MODE, "split");
  });

  it("认得出统一", () => {
    assert.equal(diffModeOf("unified"), "unified");
  });

  it("存的是双栏就还是双栏", () => {
    assert.equal(diffModeOf("split"), "split");
  });

  it("没存过、空串或脏值都回落到默认", () => {
    assert.equal(diffModeOf(null), "split");
    assert.equal(diffModeOf(""), "split");
    assert.equal(diffModeOf("inline"), "split");
  });
});

describe("diffWrapOf", () => {
  it("默认不换行", () => {
    assert.equal(DEFAULT_DIFF_WRAP, false);
  });

  it("只认字符串 true", () => {
    assert.equal(diffWrapOf("true"), true);
    assert.equal(diffWrapOf("false"), false);
    assert.equal(diffWrapOf("1"), false);
    assert.equal(diffWrapOf(null), false);
  });
});
