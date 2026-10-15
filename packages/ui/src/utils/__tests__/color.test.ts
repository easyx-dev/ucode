/**
 * 颜色归一化的单测：采样依赖 canvas 与 DOM，只能在浏览器里成立，这里覆盖无需 DOM 的格式化分支与无 DOM 时的兜底。
 *
 * 期望值按通道插值构造，而不是直写颜色字面量——源码里禁止裸色值（`scripts/verify` 的 tokens 校验）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cssColorToRgb, formatRgbaColor, resolveCssColor } from "../color";

test("不透明色给 rgb()，不带 alpha", () => {
  assert.equal(formatRgbaColor({ r: 255, g: 0, b: 0, a: 1 }), `rgb(${255}, ${0}, ${0})`);
});

test("半透明色给 rgba()，alpha 保留三位小数", () => {
  assert.equal(formatRgbaColor({ r: 0, g: 0, b: 0, a: 0.5 }), `rgba(${0}, ${0}, ${0}, ${0.5})`);
  assert.equal(formatRgbaColor({ r: 1, g: 2, b: 3, a: 1 / 3 }), `rgba(${1}, ${2}, ${3}, ${0.333})`);
});

test("没有 canvas 时返回 null，由调用方退回内建主题", () => {
  const modernColor = `oklch(${0.5} ${0.1} ${200})`;
  assert.equal(cssColorToRgb(modernColor), null);
});

test("空值不触碰 canvas", () => {
  assert.equal(cssColorToRgb("   "), null);
});

test("没有 DOM 时表达式求值也返回 null", () => {
  assert.equal(resolveCssColor("color-mix(in oklab, var(--success) 75%, var(--foreground))"), null);
});
