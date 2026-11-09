/** plugins 域的共享枚举：信任来源、诊断级别与组件分组，server 判定、客户端渲染共用 */

/**
 * 信任来源。执行类组件（hooks / extensions / bin）只有 `official` 与 `local` 会注入运行时，
 * 第三方市场来的只解析出诊断。
 */
export const PLUGIN_SOURCES = ["official", "local", "market"] as const;

export type PluginSource = (typeof PLUGIN_SOURCES)[number];

/** 诊断级别：error 表示对应组件或插件不可用，warning 表示降级使用，info 表示仅告知 */
export const PLUGIN_DIAGNOSTIC_LEVELS = ["error", "warning", "info"] as const;

export type PluginDiagnosticLevel = (typeof PLUGIN_DIAGNOSTIC_LEVELS)[number];

/**
 * 组件分组：诊断归类、设置页分节与「未注入运行时」的标注都按它分。
 *
 * `ui` 与 `server` 是本产品专属的两类代码组件：前者由渲染层动态加载（视图、文档渲染器、
 * 提及渲染器、设置分区），后者在本机服务进程内加载（自有路由、工具）。Claude / ZCode 不认识
 * 这两个键，忽略即可。
 */
export const PLUGIN_COMPONENT_GROUPS = [
  "manifest",
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcp",
  "bin",
  "extensions",
  "ui",
  "server",
  "userConfig",
] as const;

export type PluginComponentGroup = (typeof PLUGIN_COMPONENT_GROUPS)[number];

/**
 * 执行类组件：来源门控只对这几组生效，来自第三方市场时只出诊断、不注入。
 * `ui` 与 `server` 同样是「在你的会话里跑代码」——界面代码拿的是渲染层的全部能力
 * （能读会话、能调白名单动作），所以与扩展同档，不因为「只是界面」放宽。
 */
export const PLUGIN_EXECUTABLE_GROUPS: readonly PluginComponentGroup[] = [
  "hooks",
  "extensions",
  "bin",
  "ui",
  "server",
];

/**
 * 插件启用开关的层，**数组顺序即优先级**（前者胜）：
 * 本地覆盖 `<cwd>/.<slug>/plugins.local.json` → 项目覆盖 `<cwd>/.<slug>/plugins.json` → 用户登记表。
 * 覆盖只翻已登记插件的开关，永远不能把新代码带进这台机器。
 */
export const PLUGIN_SWITCH_LAYERS = ["local", "project", "user"] as const;

export type PluginSwitchLayer = (typeof PLUGIN_SWITCH_LAYERS)[number];
