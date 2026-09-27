import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import { startMcpServer } from "../client.ts";
import { enabledServers, parseMcpConfig, readMcpConfig, writeMcpConfig } from "../config.ts";
import { createMcpExtension, mcpContentToText, mcpToolName } from "../extension.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "echo-mcp-server.mjs");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-test-"));
  tempDirs.push(dir);
  return dir;
}

/** 假的 pi：只收工具注册与事件处理器，够验证"装进去了什么"。 */
function fakePi(): {
  tools: { name: string; execute: (...args: unknown[]) => Promise<unknown> }[];
  handlers: Record<string, () => Promise<void>>;
} {
  const tools: { name: string; execute: (...args: unknown[]) => Promise<unknown> }[] = [];
  const handlers: Record<string, () => Promise<void>> = {};
  return {
    tools,
    handlers,
    // @ts-expect-error 只实现被测代码用到的两个方法
    registerTool: (tool) => tools.push(tool),
    // @ts-expect-error 同上
    on: (event, handler) => {
      handlers[event] = handler;
    },
  };
}

const ECHO_SERVER = { name: "echo", command: process.execPath, args: [FIXTURE] };

describe("parseMcpConfig", () => {
  it("接受合法条目，跳过不合法的（一条写错不该让所有服务器都起不来）", () => {
    const config = parseMcpConfig({
      servers: [
        { name: "a", command: "node" },
        { name: "", command: "node" },
        { name: "b" },
        "不是对象",
      ],
    });
    expect(config.servers.map((server) => server.name)).toEqual(["a"]);
  });

  it("形状不对时当作没有配置", () => {
    expect(parseMcpConfig(null)).toEqual({ servers: [] });
    expect(parseMcpConfig({ servers: "nope" })).toEqual({ servers: [] });
  });
});

describe("readMcpConfig", () => {
  it("文件不存在或损坏都当作没有配置", async () => {
    const root = await tempRoot();
    expect(await readMcpConfig(join(root, "mcp.json"))).toEqual({ servers: [] });
    await writeFile(join(root, "mcp.json"), "{ 坏掉", "utf8");
    expect(await readMcpConfig(join(root, "mcp.json"))).toEqual({ servers: [] });
  });

  it("写进去的配置能读回来", async () => {
    const root = await tempRoot();
    const file = join(root, "nested", "mcp.json");
    await writeMcpConfig(file, { servers: [ECHO_SERVER] });
    expect(await readMcpConfig(file)).toEqual({ servers: [ECHO_SERVER] });
  });
});

describe("enabledServers", () => {
  it("显式 enabled:false 的不启", () => {
    const config = parseMcpConfig({
      servers: [
        { name: "on", command: "node" },
        { name: "off", command: "node", enabled: false },
      ],
    });
    expect(enabledServers(config).map((server) => server.name)).toEqual(["on"]);
  });
});

describe("startMcpServer", () => {
  it("握手 → 列工具 → 调工具", async () => {
    const client = await startMcpServer({ ...ECHO_SERVER, timeoutMs: 8_000 });
    try {
      const tools = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
      expect(client.toolCount).toBe(1);
      const result = await client.callTool("echo", { text: "hi" });
      expect(result.isError).toBe(false);
      expect(mcpContentToText(result.content)).toBe("echo:hi");
    } finally {
      await client.close();
    }
  });

  it("工具报错时 isError 透传（由调用方翻成异常）", async () => {
    const client = await startMcpServer({ ...ECHO_SERVER, timeoutMs: 8_000 });
    try {
      const result = await client.callTool("echo", { text: "__boom__" });
      expect(result.isError).toBe(true);
      expect(mcpContentToText(result.content)).toBe("工具执行失败");
    } finally {
      await client.close();
    }
  });

  it("命令不存在时明确失败，不挂住", async () => {
    await expect(
      startMcpServer({ name: "bad", command: "/nonexistent/mcp-server", timeoutMs: 3_000 }),
    ).rejects.toThrow(/启动失败|已退出/);
  });
});

describe("createMcpExtension", () => {
  it("把 MCP 工具注册成带服务器前缀的 pi 工具，并在会话结束时关掉服务器", async () => {
    const root = await tempRoot();
    await writeMcpConfig(servicePaths(root).mcp, { servers: [ECHO_SERVER] });
    const pi = fakePi();
    await createMcpExtension({ root })(pi as never);

    expect(pi.tools.map((tool) => tool.name)).toEqual([mcpToolName("echo", "echo")]);
    const result = (await pi.tools[0]?.execute("id", { text: "yo" }, undefined, undefined, {})) as {
      content: { text: string }[];
    };
    expect(result.content[0]?.text).toBe("echo:yo");

    const shutdown = pi.handlers.session_shutdown;
    expect(shutdown).toBeDefined();
    await shutdown?.();
  });

  it("一个服务器起不来不影响其他：只发提醒，好的照常挂载", async () => {
    const root = await tempRoot();
    await writeMcpConfig(servicePaths(root).mcp, {
      servers: [{ name: "bad", command: "/nonexistent/mcp-server" }, ECHO_SERVER],
    });
    const notices: string[] = [];
    const pi = fakePi();
    await createMcpExtension({
      root,
      onNotice: (_level, message) => notices.push(message),
    })(pi as never);

    expect(pi.tools.map((tool) => tool.name)).toEqual([mcpToolName("echo", "echo")]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("bad");
    await pi.handlers.session_shutdown?.();
  });

  it("没有配置时不注册任何工具（也不起进程）", async () => {
    const root = await tempRoot();
    const pi = fakePi();
    await createMcpExtension({ root })(pi as never);
    expect(pi.tools).toEqual([]);
  });
});
