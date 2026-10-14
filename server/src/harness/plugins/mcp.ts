/**
 * 插件 MCP 服务器的读取：`.mcp.json`（或清单 `mcpServers` 内联）→ 可并入会话 MCP 配置的条目。
 *
 * 三件事在这里定死：
 * - **命名**：服务器名 `plugin_<pluginToken>_<server>`，与用户自己的服务器分处两个命名空间；
 * - **变量**：`command` / `args` / `env` / `url` / `headers` 允许 `${user_config.*}`（都是直接 argv，不经 shell），
 *   而 `headersHelper` 是 shell 字符串，**拒绝** `${user_config.*}`（值会被 shell 再解析）；
 * - **来源**：MCP 不属于执行类组件的来源门控名单（第三方市场也生效），由调用方按会话能力决定挂不挂。
 */
import { readFileSync } from "node:fs";

import type { PluginDiagnosticView } from "@ucode/contracts";

import { PLUGIN_MCP_FILENAME } from "../../constants/dirs";
import { isRecord } from "../../utils/object";
import { diagnostic } from "./diagnostic";
import { toPluginToken } from "./sanitize";
import { type PluginVariableContext, resolvePluginVariables } from "./variables";

/** 一条可并入会话配置的插件 MCP 服务器 */
export type PluginMcpServer = {
  /** 已加插件前缀的服务器名，拼进工具名 `mcp__<server>__<tool>` */
  name: string;
  /** pi 的 `mcpServers` 条目原文（已解析变量） */
  config: Record<string, unknown>;
  /** 归属插件，便于排查与展示 */
  pluginId: string;
  /** 定义来源：文件路径或「清单 mcpServers」 */
  source: string;
};

export type PluginMcpLoad = {
  servers: PluginMcpServer[];
  diagnostics: PluginDiagnosticView[];
};

/** 服务器名会拼进工具名与 mcp 列表：与用户级 mcp.json 同一套字符集 */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 顶层既可是 `{ mcpServers: {…} }`（文件与 Claude 的写法），也可是直接的服务器表 */
const serversOf = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  const nested = "mcpServers" in value ? value.mcpServers : value;
  return isRecord(nested) ? nested : null;
};

/** 解析单个服务器的字段（只做必要校验，形状的最终判定交给 pi 的 loader） */
const resolveServer = (
  raw: unknown,
  ctx: PluginVariableContext & { diagnostics: string[]; serverName: string },
): Record<string, unknown> | null => {
  if (!isRecord(raw)) return null;
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    // headersHelper 是 shell 字符串：里面的 user_config 会被 shell 再解析
    const isShellField = key === "headersHelper";
    if (typeof value === "string") {
      const result = resolvePluginVariables(value, { ...ctx, allowUserConfig: !isShellField });
      ctx.diagnostics.push(...result.diagnostics.map((item) => `${key}: ${item}`));
      resolved[key] = result.text;
      continue;
    }
    if (Array.isArray(value)) {
      resolved[key] = value.map((item) => {
        if (typeof item !== "string") return item;
        const result = resolvePluginVariables(item, ctx);
        ctx.diagnostics.push(...result.diagnostics.map((text) => `${key}: ${text}`));
        return result.text;
      });
      continue;
    }
    if (isRecord(value)) {
      resolved[key] = Object.fromEntries(
        Object.entries(value).map(([innerKey, innerValue]) => {
          if (typeof innerValue !== "string") return [innerKey, innerValue];
          const result = resolvePluginVariables(innerValue, ctx);
          ctx.diagnostics.push(...result.diagnostics.map((text) => `${key}.${innerKey}: ${text}`));
          return [innerKey, result.text];
        }),
      );
      continue;
    }
    resolved[key] = value;
  }
  return resolved;
};

/**
 * 读取一个插件的 MCP 配置。`file` 是 `.mcp.json` 的路径（存在时优先），`inline` 是清单里的内联定义；
 * 两者都有时以文件为准并记一条诊断（与清单的「合并」语义在插件侧只保留一份，避免同一服务器两种定义）。
 */
export const loadPluginMcp = (input: {
  pluginId: string;
  pluginName: string;
  pluginRoot: string;
  pluginDataDir: string;
  config: Record<string, string | number | boolean>;
  file: string | null;
  inline: unknown;
  projectDir?: string;
}): PluginMcpLoad => {
  const diagnostics: PluginDiagnosticView[] = [];
  const token = toPluginToken(input.pluginName);
  const ctx: PluginVariableContext = {
    pluginRoot: input.pluginRoot,
    pluginDataDir: input.pluginDataDir,
    config: input.config,
    allowUserConfig: true,
    ...(input.projectDir ? { projectDir: input.projectDir } : {}),
  };

  let table: Record<string, unknown> | null = null;
  let source = "清单 mcpServers";
  if (input.file) {
    source = input.file;
    let content: string;
    try {
      content = readFileSync(input.file, "utf8");
    } catch (error) {
      diagnostics.push(
        diagnostic("error", "mcp", `${PLUGIN_MCP_FILENAME}：读不出来（${String(error)}）`),
      );
      return { servers: [], diagnostics };
    }
    try {
      table = serversOf(JSON.parse(content) as unknown);
    } catch {
      table = null;
    }
    if (input.inline !== undefined && typeof input.inline !== "string") {
      diagnostics.push(
        diagnostic("info", "mcp", `清单 mcpServers 与 ${PLUGIN_MCP_FILENAME} 同时存在，以文件为准`),
      );
    }
  } else if (typeof input.inline === "string") {
    // 清单写成路径时**不自己拼路径**：组件解析已经做过「必须在根内、以 ./ 开头」的校验，
    // 这里再拼一次等于旁路那条规则（能读到插件根外的任意 JSON）。取不到 file 就是不可用。
    if (input.inline.trim()) {
      diagnostics.push(diagnostic("error", "mcp", `${source}：路径写法没有通过组件校验，已跳过`));
    }
    return { servers: [], diagnostics };
  } else {
    table = serversOf(input.inline);
  }

  if (!table) {
    if (input.file || input.inline !== undefined) {
      diagnostics.push(diagnostic("error", "mcp", `${source}：不是 mcpServers 对象形状，已跳过`));
    }
    return { servers: [], diagnostics };
  }

  const servers: PluginMcpServer[] = [];
  for (const [serverName, raw] of Object.entries(table)) {
    const name = `plugin_${token}_${serverName}`;
    if (!SERVER_NAME.test(name)) {
      diagnostics.push(
        diagnostic("error", "mcp", `${source}：服务器名 ${serverName} 含不可用字符，已跳过`),
      );
      continue;
    }
    const fieldDiagnostics: string[] = [];
    const resolved = resolveServer(raw, {
      ...ctx,
      diagnostics: fieldDiagnostics,
      serverName,
    });
    if (!resolved) {
      diagnostics.push(
        diagnostic("error", "mcp", `${source}：${serverName} 的配置不是对象，已跳过`),
      );
      continue;
    }
    for (const message of fieldDiagnostics) {
      diagnostics.push(diagnostic("warning", "mcp", `${source}：${serverName} 的 ${message}`));
    }
    servers.push({ name, config: resolved, pluginId: input.pluginId, source });
  }

  return { servers, diagnostics };
};
