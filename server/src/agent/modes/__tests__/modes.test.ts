/** 模式声明单测：三种模式齐全，且只读模式不暴露写盘 / 执行工具（M-02） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_MODES } from "@ucode/contracts";

import { MODES } from "../index";

describe("MODES", () => {
  it("契约里的每个模式都有声明", () => {
    for (const mode of SESSION_MODES) {
      assert.ok(MODES[mode], `缺少模式声明 ${mode}`);
      assert.equal(MODES[mode].slug, mode);
      assert.ok(MODES[mode].prompt.length > 0, `${mode} 缺少提示词片段`);
    }
  });

  it("M-02 plan / ask 模式工具集只有只读与联网工具", () => {
    const expected = ["read", "grep", "find", "ls", "webfetch", "websearch"];
    for (const mode of ["plan", "ask"] as const) {
      const tools = MODES[mode].tools ?? [];
      for (const name of ["edit", "write", "bash"]) {
        assert.ok(!tools.includes(name), `${mode} 模式不应暴露 ${name}`);
      }
      for (const name of expected) {
        assert.ok(tools.includes(name), `${mode} 模式缺少只读工具 ${name}`);
      }
    }
  });

  it("build 使用全部可用工具（null），不需要逐个枚举", () => {
    assert.equal(MODES.build.tools, null);
  });
});
