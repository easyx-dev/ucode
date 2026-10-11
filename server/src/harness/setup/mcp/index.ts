/**
 * 内置 MCP 扩展接入：随「全权」会话（默认工具集且未被规则断掉写盘 / 执行）加载会话 harnessDir 下的
 * `mcp.json`，只读会话不挂。
 *
 * 不挂只读会话的理由：MCP 扩展在服务器连接成功后会主动 `setActiveTools()` 激活 codemode，
 * 而且 MCP 工具名是动态的，按工具名 deny 的只读规则兜不住它。是否加载由调用方按角色能力判定
 * （见 `harness/setup/session-config` 的 `withExtensions`）。
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
 * MCP 扩展工厂。`harnessDir` 必须由调用方传入会话实际使用的目录（评测 / 测试会覆盖它做隔离），
 * 工厂里不能用 `env.mcpConfigPath`，否则会读到用户真实数据目录。
 */
export const mcpExtension = (harnessDir: string): ExtensionFactory =>
  createMcpExtension({
    loadConfig: () => readMcpConfigForLoader(mcpConfigPathOf(harnessDir)),
  });
