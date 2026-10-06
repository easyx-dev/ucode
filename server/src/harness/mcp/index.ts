/**
 * 内置 MCP 扩展接入：随「默认工具集」的会话加载会话 agentDir 下的 `mcp.json`，只读白名单会话不挂。
 *
 * 不挂只读会话的理由：MCP 扩展在服务器连接成功后会主动 `setActiveTools()` 激活 codemode，
 * 这一步与白名单无关，会绕过 `plan` / `ask` 的只读工具集。是否加载由调用方按角色能力判定。
 */
import { createMcpExtension, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { mcpConfigPathOf, readMcpConfigForLoader } from "./config";

export {
  deleteMcpServer,
  mcpConfigPathOf,
  readMcpConfig,
  readMcpConfigForLoader,
  writeMcpServer,
} from "./config";

/**
 * MCP 扩展工厂。`agentDir` 必须由调用方传入会话实际使用的目录（评测 / 测试会覆盖它做隔离），
 * 工厂里不能用 `env.mcpConfigPath`，否则会读到用户真实数据目录。
 */
export const mcpExtension = (agentDir: string): ExtensionFactory =>
  createMcpExtension({
    loadConfig: () => readMcpConfigForLoader(mcpConfigPathOf(agentDir)),
  });
