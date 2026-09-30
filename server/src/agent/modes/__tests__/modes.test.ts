/** 模式声明单测：三种模式齐全，build 走默认集，只读模式不暴露写盘 / 执行工具（M-02 / TS-01 / TS-02） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_MODES } from "@ucode/contracts";

import { DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "../../tools";
import { MODES } from "../index";

/** 取只读模式的白名单；声明成 allowlist 是这些模式的前提 */
const allowlistOf = (mode: "plan" | "ask"): string[] => {
  const selection = MODES[mode].toolSelection;
  assert.equal(selection.kind, "allowlist");
  return selection.kind === "allowlist" ? selection.tools : [];
};

describe("MODES", () => {
  it("契约里的每个模式都有声明", () => {
    for (const mode of SESSION_MODES) {
      assert.ok(MODES[mode], `缺少模式声明 ${mode}`);
      assert.equal(MODES[mode].slug, mode);
      assert.ok(MODES[mode].prompt.length > 0, `${mode} 缺少提示词片段`);
    }
  });

  it("TS-01 build 走默认集：内置工具 + codemode", () => {
    const selection = MODES.build.toolSelection;
    assert.equal(selection.kind, "defaultTools");
    if (selection.kind !== "defaultTools") return;
    assert.deepEqual(selection.defaultTools, [
      ...DEFAULT_BUILTIN_TOOLS,
      ...DEFAULT_EXTENSION_TOOLS,
    ]);
    assert.ok(selection.defaultTools.includes("codemode"));
  });

  it("TS-02 / M-02 plan / ask 走只读白名单，不含写盘 / 执行工具与 codemode", () => {
    const readOnly = ["read", "grep", "find", "ls", "webfetch", "websearch"];
    for (const mode of ["plan", "ask"] as const) {
      const tools = allowlistOf(mode);
      for (const name of ["edit", "write", "bash", "codemode"]) {
        assert.ok(!tools.includes(name), `${mode} 不应暴露 ${name}`);
      }
      for (const name of readOnly) {
        assert.ok(tools.includes(name), `${mode} 缺少只读工具 ${name}`);
      }
    }
    assert.deepEqual(allowlistOf("ask"), readOnly);
    assert.deepEqual(allowlistOf("plan"), [...readOnly, "present_plan"]);
  });
});
