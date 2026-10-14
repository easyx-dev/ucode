/**
 * 插件宿主的视图模型：注册表构建产物。
 *
 * 安装来源与状态结构在 `state.ts`（那一份带 zod schema，类型由它派生）；
 * 这里只放不需要校验的派生结构。
 */
import type { PluginComponentGroup, PluginDiagnosticView, PluginSource } from "@ucode/contracts";

import type { PluginHookBinding } from "./hooks";
import type { PluginUserConfigField } from "./manifest";
import type { PluginMcpServer } from "./mcp";

/** 清单解析出的一个组件：路径已归一化，且校验过落在插件根内 */
export type PluginComponentEntry = {
  group: PluginComponentGroup;
  /** 组件名：技能 / 命令 / 角色的目录名或文件名（不含扩展名） */
  name: string;
  /** 目录或文件的绝对路径；清单内联定义（命令内容、hooks、mcpServers）为 null */
  path: string | null;
};

/**
 * 装配期注入用的目录：loader 的 `additionalSkillPaths` / `additionalPromptTemplatePaths` /
 * `additionalExtensionPaths` 收的是目录或文件路径，不是逐个组件，所以单独留一份。
 */
export type PluginAssetDirs = {
  /** 技能目录（含 SKILL.md 的目录，或容纳技能目录的父目录） */
  skills: string[];
  /** 命令目录（`*.md` 的所在目录） */
  prompts: string[];
  /** pi 扩展的文件路径 */
  extensions: string[];
};

/** 插件贡献的技能 / 命令目录：装配层注入 loader 时用 */
export type PluginCommandAssets = {
  skills: string[];
  prompts: string[];
};

/**
 * 装配期注入的插件贡献：资源目录与子角色。
 * `core` / `harness/setup` 只消费这个形状，不认识插件宿主的内部结构。
 *
 * 每个入口都带**会话工作目录**：生效开关按 `<cwd>/.<slug>/plugins.json` 覆盖，
 * 同一个插件在 A 仓库开着、在 B 仓库关着是常态。
 */
export type PluginContributions = {
  commandAssets: (cwd?: string) => PluginCommandAssets;
  agents: (cwd?: string) => PluginAgentFile[];
  /** 可信来源（`official` / `local`）的 pi 扩展文件路径；第三方市场的不注入 */
  extensionPaths: (cwd?: string) => string[];
  /** 可信来源的 `bin/` 目录；并入会话 bash 的 PATH，第三方市场的不注入 */
  binDirs: (cwd?: string) => string[];
  /** 可信来源的命令式 hook 绑定；第三方市场的不挂载 */
  hooks: (cwd?: string) => PluginHookBinding[];
  /** 插件声明的 MCP 服务器；MCP 不在执行类组件的来源门控名单里 */
  mcpServers: (cwd?: string) => PluginMcpServer[];
};

/**
 * 插件声明的子角色：slug 已带插件前缀、工具名已换成 pi 侧名字。
 * 把它变成 `AgentProfile` 是装配层的事（`harness/setup/agents/custom.ts`）——
 * 插件宿主不认识角色能力的解析规则。
 */
export type PluginAgentFile = {
  /** 已加插件前缀的 slug（冲突时带哈希后缀） */
  slug: string;
  /** 展示名：清单里的 name，缺省取文件名 */
  label: string;
  description: string;
  /** 提示词正文（frontmatter 之后的部分） */
  promptSection: string;
  /** 工具白名单（Claude `tools` 映射后）；空数组表示不限 */
  tools: string[];
  /** 工具黑名单（Claude `disallowedTools` 映射后）；空数组表示不排除 */
  disallowedTools: string[];
  /** 覆盖模型；缺省继承父会话 */
  model?: string;
};

/** 注册表里的一个插件：登记信息 + 清单装载结果 + 来源门控结论 */
export type PluginDescriptor = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  /** 信任档位，由来源决定 */
  source: PluginSource;
  enabled: boolean;
  /** 安装目录绝对路径 */
  root: string;
  installedAt: string;
  /** 来源内容是否已变（由显式「检查更新」的动作写入） */
  updateAvailable: boolean;
  /** 远端最新版本：npm / 清单能给出时才有 */
  latestVersion?: string;
  /** 上次检查更新的时间（ISO 8601） */
  checkedAt?: string;
  /** 解析出的组件；未启用也照样解析，供设置页展示与排查 */
  components: PluginComponentEntry[];
  /** 装配期注入用的目录（技能 / 命令 / 扩展） */
  assets: PluginAssetDirs;
  /** userConfig 的声明；宿主按它渲染配置表单 */
  userConfig: PluginUserConfigField[];
  /** userConfig 的已存值 */
  config: Record<string, string | number | boolean>;
  /** 插件声明的子角色（slug 已加插件前缀） */
  agents: PluginAgentFile[];
  /** 插件声明的命令式 hook（已按事件映射好；来源门控决定挂不挂） */
  hooks: PluginHookBinding[];
  /** 插件声明的 MCP 服务器（名字已加插件前缀、变量已解析） */
  mcpServers: PluginMcpServer[];
  /** 因来源为第三方市场而不注入运行时的执行类组件分组 */
  blocked: PluginComponentGroup[];
  diagnostics: PluginDiagnosticView[];
};

/** 一次注册表构建的结果；变更后重建，不做模块级缓存 */
export type PluginRegistry = {
  revision: number;
  plugins: PluginDescriptor[];
  /** 登记表本身的问题（重复 id、来源不可用等），与单个插件的诊断分开 */
  diagnostics: PluginDiagnosticView[];
};
