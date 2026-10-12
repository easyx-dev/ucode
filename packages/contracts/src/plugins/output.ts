/** plugins 域的响应模型：已登记插件的视图、组件摘要与诊断 */
import type { PluginComponentGroup, PluginDiagnosticLevel, PluginSource } from "./constants";

/**
 * 一条诊断：坏清单、越界组件路径、未注入的执行类组件都走它。
 * 诊断只影响所属组件，不阻断其它插件——运行时数据坏了就跳过并报告，与自定义角色同一口径。
 */
export type PluginDiagnosticView = {
  level: PluginDiagnosticLevel;
  /** 归属组件；清单本身的问题记 `manifest` */
  component: PluginComponentGroup;
  /** 面向用户的中文说明；服务端不本地化，与失败封套同一口径 */
  message: string;
};

/** 各组件组的数量：列表页用它显示「3 个技能 / 1 个 MCP」 */
export type PluginComponentCounts = {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
  bin: number;
  extensions: number;
};

export type PluginView = {
  /** 身份 `<name>@<marketplace>`；直接登记的本地目录用 `<name>@local` */
  id: string;
  /** 清单里的 name，缺省取安装目录名 */
  name: string;
  /** 界面显示名，缺省与 `name` 相同 */
  displayName: string;
  description: string;
  version: string;
  /** 信任档位：执行类组件是否注入按它判定 */
  source: PluginSource;
  enabled: boolean;
  /** 安装目录绝对路径（`${*_PLUGIN_ROOT}` 指向它） */
  path: string;
  /** 安装时间（ISO 8601） */
  installedAt: string;
  components: PluginComponentCounts;
  /** 按来源判定为「不注入运行时」的组件分组：界面据此直说为什么 hook 不跑 */
  blockedComponents: PluginComponentGroup[];
  diagnostics: PluginDiagnosticView[];
};

export type PluginsListResponse = {
  plugins: PluginView[];
  /** 状态文件绝对路径，供设置页展示与排查 */
  statePath: string;
  /** 注册表代次：变更入口推进它，会话按它决定是否重建 */
  revision: number;
};

/** 安装 / 启停 / 重拉的统一回执：变更后的插件视图与新的代次 */
export type PluginWriteResponse = {
  plugin: PluginView;
  revision: number;
  /** 契约视图之外的登记信息不回显；客户端刷新列表即可拿到其它插件 */
};

export type PluginDeleteResponse = {
  /** 是否命中并移除了登记；目标不存在时报错，故恒为 true */
  removed: boolean;
  /** 是否连磁盘内容一并清理（`purge`）；本地目录来源的内容不会被删 */
  purged: boolean;
  revision: number;
};
