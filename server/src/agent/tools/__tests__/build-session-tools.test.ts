/**
 * 工具集装配单测（对应阶段 1 的 1a 与工具可用性验收）。
 *
 * pi 的 `tools` 是白名单：自研工具漏进白名单就会被 `_refreshToolRegistry` 过滤掉，
 * 所以这里盯的是「内置清单 + 自研工具名」这一对必须齐平。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSessionTools, DEFAULT_BUILTIN_TOOLS } from "../index";

const assembly = buildSessionTools(() => ({ provider: "tavily", apiKey: "", baseUrl: "" }));

describe("buildSessionTools", () => {
  it("内置清单包含只读检索工具", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.ok(DEFAULT_BUILTIN_TOOLS.includes(name), `缺少内置工具 ${name}`);
    }
  });

  it("自研工具都在白名单里", () => {
    assert.deepEqual(assembly.customTools.map((tool) => tool.name).sort(), [
      "webfetch",
      "websearch",
    ]);
    for (const tool of assembly.customTools) {
      assert.ok(assembly.tools.includes(tool.name), `${tool.name} 不在 tools 白名单里`);
    }
  });

  it("白名单不含未启用的内置工具", () => {
    assert.ok(!assembly.tools.includes("powershell"));
  });

  it("自研工具都带系统提示词片段", () => {
    for (const tool of assembly.customTools) {
      assert.ok(tool.description.length > 0, `${tool.name} 缺少 description`);
      assert.ok(tool.promptSnippet, `${tool.name} 缺少 promptSnippet`);
    }
  });
});
