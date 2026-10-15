/** 终端配色：ANSI 十六色与界面色是否齐全、缺色时是否整体退回 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTerminalTheme } from "../terminal-theme";

/**
 * 假采样：任何表达式都给同一个颜色。
 * 期望值按通道插值构造，而不是直写颜色字面量——源码里禁止裸色值（`scripts/verify` 的 tokens 校验）。
 */
const STUB_COLOR = `rgb(${1}, ${2}, ${3})`;

const resolver = (): string => STUB_COLOR;

describe("buildTerminalTheme", () => {
  it("八组 ANSI 基色与对应的亮色都在", () => {
    const theme = buildTerminalTheme(resolver);
    assert.ok(theme);
    const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
    for (const name of names) {
      const bright = `bright${name[0]?.toUpperCase()}${name.slice(1)}`;
      assert.equal(typeof theme[name as keyof typeof theme], "string", `缺 ${name}`);
      assert.equal(typeof theme[bright as keyof typeof theme], "string", `缺 ${bright}`);
    }
  });

  it("界面色取设计 token（底色跟随面板、选中走状态层）", () => {
    const seen: string[] = [];
    const theme = buildTerminalTheme((expression) => {
      seen.push(expression);
      return STUB_COLOR;
    });
    assert.ok(theme);
    assert.equal(theme.background, STUB_COLOR);
    assert.equal(theme.foreground, STUB_COLOR);
    assert.ok(seen.includes("var(--surface)"));
    assert.ok(seen.includes("var(--state-selected)"));
  });

  it("亮色由基色朝前景偏一档派生，不是另立一套色", () => {
    const seen: string[] = [];
    buildTerminalTheme((expression) => {
      seen.push(expression);
      return STUB_COLOR;
    });
    assert.ok(seen.some((expression) => expression.includes("75%, var(--foreground)")));
  });

  it("少一个色就整体退回（返回 null），不混用半套", () => {
    const theme = buildTerminalTheme((expression) =>
      expression === "var(--muted)" ? null : STUB_COLOR,
    );
    assert.equal(theme, null);
  });
});
