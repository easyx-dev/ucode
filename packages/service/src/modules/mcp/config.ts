import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../../storage/index.ts";

/**
 * MCP 服务器登记（`<服务目录>/mcp.json`）。
 *
 * 与 SSH 注册表同一条立场：**只登记怎么启动/连上，不存任何凭据**——
 * 需要密钥的服务器，密钥由被启动的进程自己按它的约定去读环境变量或主机上的配置。
 */

export type McpServerConfig = {
  name: string;
  /** 启动命令（stdio 传输）：如 `npx` / 本机可执行文件路径。 */
  command: string;
  args?: string[];
  /** 追加的环境变量（在继承的环境之上）。 */
  env?: Record<string, string>;
  cwd?: string;
  /** 省略视为启用。 */
  enabled?: boolean;
};

export type McpConfig = { servers: McpServerConfig[] };

const EMPTY: McpConfig = { servers: [] };

function isServerConfig(value: unknown): value is McpServerConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name !== "" &&
    typeof candidate.command === "string" &&
    candidate.command !== ""
  );
}

export function parseMcpConfig(raw: unknown): McpConfig {
  if (typeof raw !== "object" || raw === null) return EMPTY;
  const servers = (raw as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return EMPTY;
  // 不合法的条目跳过而不是整体拒绝：一条写错不该让所有 MCP 服务器都起不来。
  return { servers: servers.filter(isServerConfig) };
}

/** 读配置；缺失或损坏都当"没有配置"（不是错误——大多数用户不装 MCP）。 */
export async function readMcpConfig(file: string): Promise<McpConfig> {
  try {
    return parseMcpConfig(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return EMPTY;
  }
}

export async function writeMcpConfig(file: string, config: McpConfig): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** 该启的服务器：显式 `enabled: false` 的不启。 */
export function enabledServers(config: McpConfig): McpServerConfig[] {
  return config.servers.filter((server) => server.enabled !== false);
}
