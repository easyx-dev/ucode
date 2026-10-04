/**
 * MCP 配置读写单测：坏文件不抛错、写盘往返、未知顶层键保留、删除的命中与否，
 * 以及交给 pi 装载器的形状（name 作键、source / scope 齐全）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { McpUpsertInput } from "@ucode/contracts";

import { deleteMcpServer, readMcpConfig, readMcpConfigForLoader, writeMcpServer } from "../config";

const dir = mkdtempSync(join(tmpdir(), "mcp-config-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
const freshPath = (): string => join(dir, `mcp-${counter++}.json`);

type StdioServer = Extract<McpUpsertInput, { type: "stdio" }>;

const stdioServer = (name: string): StdioServer => ({
  name,
  enabled: true,
  exposure: "codemode",
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
});

describe("readMcpConfig", () => {
  it("文件不存在时返回空列表", () => {
    const response = readMcpConfig(freshPath());
    assert.deepEqual(response.servers, []);
    assert.deepEqual(response.errors, []);
  });

  it("缺省 type 按 stdio 解析，缺省 enabled / exposure 补默认值", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify({ mcpServers: { fs: { command: "npx" } } }), "utf8");
    const response = readMcpConfig(path);
    assert.deepEqual(response.errors, []);
    assert.deepEqual(response.servers, [
      { name: "fs", enabled: true, exposure: "codemode", type: "stdio", command: "npx" },
    ]);
  });

  it("坏 JSON 只回报错误、不抛异常", () => {
    const path = freshPath();
    writeFileSync(path, "{ not json", "utf8");
    const response = readMcpConfig(path);
    assert.deepEqual(response.servers, []);
    assert.match(response.errors[0] ?? "", /不是合法 JSON/);
  });

  it("单条非法只影响自身，其余条目照常返回", () => {
    const path = freshPath();
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { bad: { type: "stdio" }, ok: { command: "node" } } }),
      "utf8",
    );
    const response = readMcpConfig(path);
    assert.equal(response.servers.length, 1);
    assert.equal(response.servers[0]?.name, "ok");
    assert.match(response.errors[0] ?? "", /bad/);
  });

  it("deferred 暴露方式合法，codemode-deferred 不再支持", () => {
    const path = freshPath();
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          a: { command: "npx", exposure: "deferred" },
          b: { command: "npx", exposure: "codemode-deferred" },
        },
      }),
      "utf8",
    );
    const response = readMcpConfig(path);
    assert.deepEqual(
      response.servers.map((server) => server.exposure),
      ["deferred"],
    );
    assert.equal(response.errors.length, 1);
    assert.match(response.errors[0] ?? "", /服务器 b /);
  });
});

describe("writeMcpServer / deleteMcpServer", () => {
  it("写盘往返：name 作键，条目里不再带 name", () => {
    const path = freshPath();
    writeMcpServer(stdioServer("fs"), path);

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(onDisk.mcpServers), ["fs"]);
    assert.equal("name" in (onDisk.mcpServers.fs as object), false);

    assert.deepEqual(readMcpConfig(path).servers, [stdioServer("fs")]);
  });

  it("保留未知顶层键与 autoEnableCodemode", () => {
    const path = freshPath();
    writeFileSync(
      path,
      JSON.stringify({ autoEnableCodemode: false, custom: 1, mcpServers: {} }),
      "utf8",
    );
    writeMcpServer(stdioServer("fs"), path);

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(onDisk.autoEnableCodemode, false);
    assert.equal(onDisk.custom, 1);
  });

  it("同名再写为覆盖", () => {
    const path = freshPath();
    writeMcpServer(stdioServer("fs"), path);
    writeMcpServer({ ...stdioServer("fs"), command: "bunx" }, path);
    assert.equal(readMcpConfig(path).servers[0]?.type === "stdio", true);
    assert.equal(readMcpConfig(path).servers.length, 1);
    const config = readMcpConfigForLoader(path).servers[0]?.config;
    assert.equal(config?.type === "stdio" ? config.command : "", "bunx");
  });

  it("删除命中返回 true 并从文件移除，未命中返回 false", () => {
    const path = freshPath();
    writeMcpServer(stdioServer("fs"), path);
    assert.deepEqual(deleteMcpServer("fs", path).removed, true);
    assert.deepEqual(readMcpConfig(path).servers, []);
    assert.deepEqual(deleteMcpServer("fs", path).removed, false);
  });

  it("坏 JSON 上写入按空配置处理，可覆盖修复", () => {
    const path = freshPath();
    writeFileSync(path, "{ not json", "utf8");
    writeMcpServer(stdioServer("fs"), path);
    assert.deepEqual(readMcpConfig(path).servers, [stdioServer("fs")]);
    assert.deepEqual(readMcpConfig(path).errors, []);
  });

  it("写入 deferred 暴露方式并被 pi 装载器原样透传", () => {
    const path = freshPath();
    writeMcpServer({ ...stdioServer("fs"), exposure: "deferred" }, path);
    assert.equal(readMcpConfigForLoader(path).servers[0]?.config.exposure, "deferred");
  });

  it("写入保留本服务未建模的字段（toolExposure / oauth 等）", () => {
    const path = freshPath();
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          fs: {
            command: "npx",
            toolExposure: { write_file: "hidden" },
            oauth: { clientId: "abc" },
          },
        },
      }),
      "utf8",
    );
    writeMcpServer({ ...stdioServer("fs"), command: "bunx" }, path);

    const entry = JSON.parse(readFileSync(path, "utf8")).mcpServers.fs as Record<string, unknown>;
    assert.deepEqual(entry.toolExposure, { write_file: "hidden" });
    assert.deepEqual(entry.oauth, { clientId: "abc" });
    assert.equal(entry.command, "bunx");
  });
});

describe("readMcpConfigForLoader", () => {
  it("条目带 source / scope，config 是 pi 形状", () => {
    const path = freshPath();
    writeMcpServer(stdioServer("fs"), path);
    const loaded = readMcpConfigForLoader(path);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.servers.length, 1);
    const entry = loaded.servers[0];
    assert.equal(entry?.name, "fs");
    assert.equal(entry?.source, path);
    assert.equal(entry?.scope, "global");
    assert.equal(entry?.config.type === "stdio" ? entry.config.command : "", "npx");
  });

  it("原样透传未建模字段，不因本服务子集而丢失", () => {
    const path = freshPath();
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: { fs: { command: "npx", toolExposure: { write_file: "hidden" } } },
      }),
      "utf8",
    );
    const config = readMcpConfigForLoader(path).servers[0]?.config as unknown as Record<
      string,
      unknown
    >;
    assert.deepEqual(config.toolExposure, { write_file: "hidden" });
  });
});
