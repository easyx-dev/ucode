/** plugins 域的共享枚举：信任来源、诊断级别与组件分组，server 判定、客户端渲染共用 */

/**
 * 信任来源。执行类组件（hooks / extensions / bin）只有 `official` 与 `local` 会注入运行时，
 * 第三方市场来的只解析出诊断——判定与理由见 `plans/plugins.md` 第五章。
 */
export const PLUGIN_SOURCES = ["official", "local", "market"] as const;

export type PluginSource = (typeof PLUGIN_SOURCES)[number];

/** 诊断级别：error 表示对应组件或插件不可用，warning 表示降级使用，info 表示仅告知 */
export const PLUGIN_DIAGNOSTIC_LEVELS = ["error", "warning", "info"] as const;

export type PluginDiagnosticLevel = (typeof PLUGIN_DIAGNOSTIC_LEVELS)[number];

/** 组件分组：诊断归类、设置页分节与「未注入运行时」的标注都按它分 */
export const PLUGIN_COMPONENT_GROUPS = [
  "manifest",
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcp",
  "bin",
  "extensions",
  "userConfig",
] as const;

export type PluginComponentGroup = (typeof PLUGIN_COMPONENT_GROUPS)[number];

/** 执行类组件：来源门控只对这几组生效，来自第三方市场时只出诊断、不注入 */
export const PLUGIN_EXECUTABLE_GROUPS: readonly PluginComponentGroup[] = [
  "hooks",
  "extensions",
  "bin",
];
