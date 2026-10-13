/** table-prefs：表格的展示偏好（默认不换行，只认认识的存量值） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_TABLE_WRAP, tableWrapOf } from "../table-prefs";

describe("tableWrapOf", () => {
  it("默认不换行", () => {
    assert.equal(DEFAULT_TABLE_WRAP, false);
  });

  it("只认字符串 true", () => {
    assert.equal(tableWrapOf("true"), true);
    assert.equal(tableWrapOf("false"), false);
    assert.equal(tableWrapOf("1"), false);
    assert.equal(tableWrapOf(null), false);
  });
});
