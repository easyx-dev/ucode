/**
 * 插件市场（F-3.6）的线上形状。
 *
 * 三类数据：**源**（用户登记的可装插件的地方）、**目录条目**（一个源里能装什么）、
 * **已装资源**（数据层里现在有什么）。清单是纯数据、组件逐个列文件——安装器不做启发式猜测。
 */

export type MarketplaceSourceKind = "local" | "remote";

export type MarketplaceSource = {
  name: string;
  kind: MarketplaceSourceKind;
  /** local 是目录路径；remote 是清单地址。 */
  location: string;
  description?: string;
};

export type PluginComponentKind = "skill" | "prompt" | "agent" | "extension";

export type PluginComponent = {
  kind: PluginComponentKind;
  name: string;
  file?: string;
  url?: string;
};

export type CatalogEntry = {
  name: string;
  version?: string;
  description?: string;
  source: string;
  components: PluginComponent[];
};

/** 已装资源（数据层里现有的技能/提示/子智能体/扩展/主题）。 */
export type InstalledResource = { kind: string; name: string; path: string };

export type MarketplaceOverview = {
  sources: MarketplaceSource[];
  installed: InstalledResource[];
};

export type InstallResult = {
  installed: { kind: PluginComponentKind; name: string; to: string }[];
  skipped: { kind: PluginComponentKind; name: string; to: string; reason: "exists" }[];
  failed: { kind: PluginComponentKind; name: string; reason: string }[];
};
