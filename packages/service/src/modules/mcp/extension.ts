import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { servicePaths } from "../../paths.ts";
import { type McpServerClient, type McpToolDescriptor, startMcpServer } from "./client.ts";
import { enabledServers, readMcpConfig } from "./config.ts";

/**
 * 把 MCP 服务器上的工具桥进 pi。
 *
 * pi 没有内建的 MCP 支持，"MCP 桥"就是我们这一层：读 `<服务目录>/mcp.json` →
 * 启动登记的 stdio 服务器 → `tools/list` → 逐个注册成 pi 工具（名字带 `mcp__<服务器>__`
 * 前缀，避免与内置工具撞名）。
 *
 * 三条立场：
 * - **一个服务器起不来不影响会话**：只发一条提醒，其余服务器照常挂载；
 * - **工具失败 = 抛错**（pi 的工具契约里没有 isError 字段），把 MCP 的 `isError` 翻成异常文案；
 * - **会话结束就关**：不留孤儿进程（`session_shutdown`）。
 */

export type McpExtensionOptions = {
  /** 数据根（配置在 `<数据根>/v1/service/mcp.json`）。 */
  root: string;
  onNotice?: (level: "info" | "warn" | "error", message: string) => void;
};

/** 工具名前缀：MCP 工具名之间可能重名，服务器名做命名空间。 */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

/** MCP 的 content 数组 → 交给模型的文本。 */
export function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as { type?: unknown; text?: unknown };
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else parts.push(`（不支持的内容块：${String(block.type ?? "unknown")}）`);
  }
  return parts.join("\n");
}

/** 用 MCP 给的 JSON Schema 当参数 schema；给不出可用 schema 时退化成宽松对象。 */
function parametersFor(tool: McpToolDescriptor): unknown {
  const schema = tool.inputSchema;
  if (typeof schema === "object" && schema !== null) return Type.Unsafe(schema);
  return Type.Object({}, { additionalProperties: true });
}

function toolDefinition(server: McpServerClient, tool: McpToolDescriptor) {
  return {
    name: mcpToolName(server.name, tool.name),
    label: `${server.name}/${tool.name}`,
    description: `[MCP:${server.name}] ${tool.description ?? tool.name}`,
    parameters: parametersFor(tool),

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ server: string; tool: string }>> {
      const result = await server.callTool(tool.name, params);
      const text = mcpContentToText(result.content);
      if (result.isError) throw new Error(text === "" ? `MCP 工具 ${tool.name} 执行失败。` : text);
      return {
        content: [{ type: "text", text: text === "" ? "（MCP 工具没有返回文本内容）" : text }],
        details: { server: server.name, tool: tool.name },
      };
    },
  };
}

/**
 * 每会话挂载：工厂是 async 的——注册工具必须在**会话建立之前**完成，
 * 因此这里等服务器握手完再返回。
 */
export function createMcpExtension(
  options: McpExtensionOptions,
): (pi: ExtensionAPI) => Promise<void> {
  return async (pi: ExtensionAPI): Promise<void> => {
    const config = await readMcpConfig(servicePaths(options.root).mcp);
    const servers = enabledServers(config);
    if (servers.length === 0) return;

    const clients: McpServerClient[] = [];
    for (const server of servers) {
      try {
        const client = await startMcpServer({
          name: server.name,
          command: server.command,
          ...(server.args === undefined ? {} : { args: server.args }),
          ...(server.env === undefined ? {} : { env: server.env }),
          ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
        });
        const tools = await client.listTools();
        for (const tool of tools) pi.registerTool(toolDefinition(client, tool) as never);
        clients.push(client);
      } catch (error) {
        // 一个服务器坏掉不该让整个会话起不来：只报告，继续挂其余的。
        options.onNotice?.(
          "warn",
          `MCP 服务器 ${server.name} 挂载失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    pi.on("session_shutdown", async () => {
      for (const client of clients) await client.close().catch(() => undefined);
    });
  };
}
