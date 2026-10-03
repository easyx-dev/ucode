/** MCP 扩展按模式装配：build 加载，plan / ask 不加载（避免激活 codemode 绕过只读白名单） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mcpConfigPathOf, mcpExtensionForMode } from "../index";

const agentDir = "/tmp/agent";

describe("mcpConfigPathOf", () => {
  it("按传入的 agent 目录派生 mcp.json，不依赖全局 env", () => {
    assert.equal(mcpConfigPathOf(agentDir), "/tmp/agent/mcp.json");
  });
});

describe("mcpExtensionForMode", () => {
  it("build 返回扩展工厂", () => {
    assert.equal(typeof mcpExtensionForMode("build", agentDir), "function");
  });

  it("plan / ask 返回 undefined", () => {
    assert.equal(mcpExtensionForMode("plan", agentDir), undefined);
    assert.equal(mcpExtensionForMode("ask", agentDir), undefined);
  });
});
