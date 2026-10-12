/**
 * 插件 MCP 读取单测：文件名空间、变量解析（含 headersHelper 拒绝 user_config）、
 * 文件与清单内联的优先级、坏形状出诊断而不是静默。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadPluginMcp } from "../mcp";
import { PLUGIN_VARIABLE_PREFIX } from "../variables";

const dir = mkdtempSync(join(tmpdir(), "plugin-mcp-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const base = {
  pluginId: "demo@local",
  pluginName: "my-plugin",
  pluginRoot: "/plugins/demo",
  pluginDataDir: "/plugins/data/demo-local",
  config: { token: "tk-1" },
};

const messagesOf = (result: ReturnType<typeof loadPluginMcp>): string =>
  result.diagnostics.map((item) => item.message).join("\n");

describe("loadPluginMcp", () => {
  it("文件名空间加插件前缀，env / args 里的 user_config 与内置变量都解析", () => {
    const file = join(dir, "mcp-ok.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          time: {
            type: "stdio",
            command: `\${${PLUGIN_VARIABLE_PREFIX}_PLUGIN_ROOT}/bin/time.sh`,
            args: ["--data", `\${${PLUGIN_VARIABLE_PREFIX}_PLUGIN_DATA}`],
            env: { API_TOKEN: "${user_config.token}" },
          },
        },
      }),
    );

    const result = loadPluginMcp({ ...base, file, inline: undefined });
    assert.equal(result.diagnostics.length, 0);
    const server = result.servers[0];
    assert.equal(server?.name, "plugin_my-plugin_time");
    assert.equal(server?.pluginId, "demo@local");
    assert.deepEqual(server?.config, {
      type: "stdio",
      command: "/plugins/demo/bin/time.sh",
      args: ["--data", "/plugins/data/demo-local"],
      env: { API_TOKEN: "tk-1" },
    });
  });

  it("headersHelper 是 shell 字符串：里面的 user_config 被丢掉并出诊断", () => {
    const result = loadPluginMcp({
      ...base,
      file: null,
      inline: {
        remote: {
          type: "http",
          url: "https://example.invalid/mcp",
          headersHelper: 'echo \'{"Authorization":"Bearer ${user_config.token}"}\'',
          headers: { "X-Token": "${user_config.token}" },
        },
      },
    });

    const config = result.servers[0]?.config ?? {};
    assert.equal(
      (config.headers as Record<string, string>)["X-Token"],
      "tk-1",
      "headers 不是 shell 字段，照常解析",
    );
    assert.equal(
      config.headersHelper,
      `echo '{"Authorization":"Bearer "}'`,
      "shell 字段上 user_config 换成空串，而不是把值塞进去",
    );
    assert.match(messagesOf(result), /shell 字段里不能引用 user_config/);
  });

  it("文件优先于清单内联，并记一条提示", () => {
    const file = join(dir, "mcp-both.json");
    writeFileSync(
      file,
      JSON.stringify({ mcpServers: { fromFile: { type: "stdio", command: "a" } } }),
    );

    const result = loadPluginMcp({
      ...base,
      file,
      inline: { fromManifest: { type: "stdio", command: "b" } },
    });
    assert.deepEqual(
      result.servers.map((server) => server.name),
      ["plugin_my-plugin_fromFile"],
    );
    assert.match(messagesOf(result), /以文件为准/);
  });

  it("清单里写成路径时不自行解析（组件层已校验过，这里再拼一次会旁路那条规则）", () => {
    const nested = join(dir, "nested.json");
    writeFileSync(nested, JSON.stringify({ mcpServers: { x: { type: "stdio", command: "c" } } }));

    const result = loadPluginMcp({
      ...base,
      pluginRoot: dir,
      file: null,
      inline: "nested.json",
    });
    assert.deepEqual(result.servers, []);
    assert.match(messagesOf(result), /路径写法没有通过组件校验/);
  });

  it("坏形状与非法服务器名出诊断、不产出条目", () => {
    const notPath = loadPluginMcp({ ...base, file: null, inline: 42 });
    assert.deepEqual(notPath.servers, []);
    assert.match(messagesOf(notPath), /不是 mcpServers 对象形状/);

    const file = join(dir, "mcp-bad.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { "bad name": { type: "stdio" }, ok: "x" } }));
    const result = loadPluginMcp({ ...base, file, inline: undefined });
    assert.deepEqual(result.servers, []);
    assert.match(messagesOf(result), /含不可用字符/);
    assert.match(messagesOf(result), /不是对象/);
  });
});
