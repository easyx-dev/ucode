/** MCP 扩展装配：按 agentDir 派生 mcp.json 路径（是否加载由调用方按角色能力判定） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mcpConfigPathOf, mcpExtension } from "../index";

const agentDir = "/tmp/agent";

describe("mcpConfigPathOf", () => {
  it("按传入的 agent 目录派生 mcp.json，不依赖全局 env", () => {
    assert.equal(mcpConfigPathOf(agentDir), "/tmp/agent/mcp.json");
  });
});

describe("mcpExtension", () => {
  it("返回可用的扩展工厂", () => {
    assert.equal(typeof mcpExtension(agentDir), "function");
  });
});
