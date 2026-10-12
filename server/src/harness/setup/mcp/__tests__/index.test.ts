/** MCP 扩展装配：按 harnessDir 派生 mcp.json 路径（是否加载由调用方按角色能力判定） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LoadedMcpConfig, McpServerConfig } from "@earendil-works/pi-coding-agent";

import { mcpConfigPathOf, mcpExtension, mergePluginMcpServers } from "..";

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

describe("插件 MCP 合并", () => {
  const loaded = (): LoadedMcpConfig => ({
    servers: [
      {
        name: "plugin_demo_shared",
        config: { type: "stdio", command: "user-owned" } as unknown as McpServerConfig,
        source: "/home/mcp.json",
        scope: "global",
      },
      {
        name: "mine",
        config: { type: "stdio", command: "mine" } as unknown as McpServerConfig,
        source: "/home/mcp.json",
        scope: "global",
      },
    ],
    errors: [],
    autoEnableCodemode: false,
  });

  it("插件条目追加在后、标 extension，并保留用户的 autoEnableCodemode 与错误", () => {
    const merged = mergePluginMcpServers(loaded(), [
      {
        name: "plugin_demo_time",
        config: { type: "stdio", command: "time" },
        pluginId: "demo@local",
        source: "/plugins/demo/.mcp.json",
      },
    ]);

    assert.equal(merged.servers.length, 3);
    assert.equal(merged.servers[2]?.name, "plugin_demo_time");
    assert.equal(merged.servers[2]?.scope, "extension");
    assert.equal(merged.servers[2]?.source, "/plugins/demo/.mcp.json");
    assert.equal(merged.autoEnableCodemode, false);
    assert.deepEqual(merged.errors, []);
  });

  it("同名的用户条目优先：插件带来的那个被丢掉", () => {
    const merged = mergePluginMcpServers(loaded(), [
      {
        name: "plugin_demo_shared",
        config: { type: "stdio", command: "plugin-owned" },
        pluginId: "demo@local",
        source: "清单 mcpServers",
      },
    ]);

    assert.equal(merged.servers.length, 2);
    // 用非空断言：找不到就让下一行直接抛，避免静默通过
    const shared = merged.servers.find((entry) => entry.name === "plugin_demo_shared")!;
    assert.equal((shared.config as { command?: string }).command, "user-owned");
    assert.equal(shared.scope, "global");
  });

  it("没有插件服务器时原样返回", () => {
    const before = loaded();
    assert.equal(mergePluginMcpServers(before, []), before);
  });
});
