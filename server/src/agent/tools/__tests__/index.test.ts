/**
 * 自研工具装配单测：内置清单齐平、模式专属工具只在对应模式出现、工具自带提示词片段。
 *
 * 工具选择由 `modes` 声明，这里只盯 `buildCustomTools` 的产出。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WebsearchConfig } from "@ucode/contracts";

import { buildCustomTools, DEFAULT_BUILTIN_TOOLS } from "../index";

const readConfig = (): WebsearchConfig => ({ provider: "tavily", apiKey: "", baseUrl: "" });
const build = buildCustomTools(readConfig, "build");
const plan = buildCustomTools(readConfig, "plan");

const namesOf = (tools: readonly { name: string }[]): string[] =>
  tools.map((tool) => tool.name).sort();

describe("buildCustomTools", () => {
  it("内置清单包含只读检索工具，不含未启用的 powershell", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.ok(DEFAULT_BUILTIN_TOOLS.includes(name), `缺少内置工具 ${name}`);
    }
    assert.ok(!DEFAULT_BUILTIN_TOOLS.includes("powershell"));
  });

  it("build 只注册联网工具", () => {
    assert.deepEqual(namesOf(build), ["webfetch", "websearch"]);
  });

  it("present_plan 只在 plan 模式注册", () => {
    assert.ok(namesOf(plan).includes("present_plan"));
    assert.ok(!namesOf(build).includes("present_plan"));
  });

  it("自研工具都带系统提示词片段", () => {
    for (const tool of [...build, ...plan]) {
      assert.ok(tool.description.length > 0, `${tool.name} 缺少 description`);
      assert.ok(tool.promptSnippet, `${tool.name} 缺少 promptSnippet`);
    }
  });
});
