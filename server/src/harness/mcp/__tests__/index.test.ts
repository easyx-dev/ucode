/** MCP 扩展装配：按 harnessDir 派生 mcp.json 路径（是否加载由调用方按角色能力判定） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mcpConfigPathOf, mcpExtension } from "../index";

const harnessDir = "/tmp/harness";

describe("mcpConfigPathOf", () => {
  it("按传入的运行时目录派生 mcp.json，不依赖全局 env", () => {
    assert.equal(mcpConfigPathOf(harnessDir), "/tmp/harness/mcp.json");
  });
});

describe("mcpExtension", () => {
  it("返回可用的扩展工厂", () => {
    assert.equal(typeof mcpExtension(harnessDir), "function");
  });
});
