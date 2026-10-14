/** 渲染层来源约定的单测：开发形态只认显式 `--dev`，地址由端口常量派生 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isDevLaunch, RENDERER_DEV_PORT, RENDERER_DEV_URL } from "../renderer.ts";

test("RENDERER_DEV_URL 与端口常量一致", () => {
  assert.equal(RENDERER_DEV_URL, `http://localhost:${RENDERER_DEV_PORT}`);
});

test("isDevLaunch：只有显式的 --dev 才算开发形态", () => {
  assert.equal(isDevLaunch(["electron", ".", "--dev"]), true);
  // 打包分发的应用不带这个参数，不会去连 dev server
  assert.equal(isDevLaunch(["electron", "."]), false);
  assert.equal(isDevLaunch(["--debug"]), false, "不按子串匹配");
  assert.equal(isDevLaunch([]), false);
});
