/** 窗口镶边判定的单测：无标题栏样式只在 macOS 生效 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isFrameless, TITLE_BAR_INSET } from "../chrome.ts";

test("isFrameless：只有 macOS 去掉系统标题栏", () => {
  assert.equal(isFrameless("darwin"), true);
  for (const platform of ["win32", "linux", "freebsd", "openbsd", "aix", "sunos"] as const) {
    assert.equal(isFrameless(platform), false, platform);
  }
});

test("TITLE_BAR_INSET：留出的空位不小于 macOS 的 32px 标准标题栏", () => {
  assert.ok(TITLE_BAR_INSET >= 32);
  // 顶部留白按整数像素写进行内样式，非整数会被 React 当成无单位值
  assert.ok(Number.isInteger(TITLE_BAR_INSET));
});
