/**
 * 工具集装配单测（阶段 1 的内置工具 + 阶段 2.5 的模式专属工具）。
 *
 * pi 的 `tools` 是白名单：自研工具漏进白名单就会被 `_refreshToolRegistry` 过滤掉，
 * 所以这里盯的是「内置清单 + 自研工具名」必须齐平，以及模式专属工具只在对应模式出现。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WebsearchConfig } from "@ucode/contracts";

import { buildSessionTools, DEFAULT_BUILTIN_TOOLS } from "../index";

const readConfig = (): WebsearchConfig => ({ provider: "tavily", apiKey: "", baseUrl: "" });
const build = buildSessionTools(readConfig, "build");
const plan = buildSessionTools(readConfig, "plan");

describe("buildSessionTools", () => {
  it("内置清单包含只读检索工具", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.ok(DEFAULT_BUILTIN_TOOLS.includes(name), `缺少内置工具 ${name}`);
    }
  });

  it("自研工具都在白名单里", () => {
    assert.deepEqual(build.customTools.map((tool) => tool.name).sort(), ["webfetch", "websearch"]);
    for (const tool of build.customTools) {
      assert.ok(build.tools.includes(tool.name), `${tool.name} 不在 tools 白名单里`);
    }
  });

  it("present_plan 只在 plan 模式注册", () => {
    assert.ok(plan.customTools.some((tool) => tool.name === "present_plan"));
    assert.ok(plan.tools.includes("present_plan"));
    assert.ok(!build.tools.includes("present_plan"));
  });

  it("白名单不含未启用的内置工具", () => {
    assert.ok(!build.tools.includes("powershell"));
  });

  it("自研工具都带系统提示词片段", () => {
    for (const tool of [...build.customTools, ...plan.customTools]) {
      assert.ok(tool.description.length > 0, `${tool.name} 缺少 description`);
      assert.ok(tool.promptSnippet, `${tool.name} 缺少 promptSnippet`);
    }
  });
});
