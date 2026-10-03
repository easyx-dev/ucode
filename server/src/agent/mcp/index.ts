/**
 * 内置 MCP 扩展接入：`build` 模式连接会话 agentDir 下的 `mcp.json`，只读模式不加载。
 *
 * 不加载只读模式的理由：MCP 扩展在服务器连接成功后会主动 `setActiveTools()` 激活 codemode，
 * 这一步与模式白名单无关，会绕过 `plan` / `ask` 的只读工具集。
 */
import { createMcpExtension, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SessionMode } from "@ucode/contracts";

import { mcpConfigPathOf, readMcpConfigForLoader } from "./config";

export {
  deleteMcpServer,
  mcpConfigPathOf,
  readMcpConfig,
  readMcpConfigForLoader,
  writeMcpServer,
} from "./config";

/**
 * 按模式取 MCP 扩展工厂；`build` 才返回，`plan` / `ask` 保持只读。
 * `agentDir` 必须由调用方传入会话实际使用的目录（评测 / 测试会覆盖它做隔离），
 * 工厂里不能用 `env.mcpConfigPath`，否则会读到用户真实数据目录。
 */
export const mcpExtensionForMode = (
  mode: SessionMode,
  agentDir: string,
): ExtensionFactory | undefined =>
  mode === "build"
    ? createMcpExtension({
        loadConfig: () => readMcpConfigForLoader(mcpConfigPathOf(agentDir)),
      })
    : undefined;
