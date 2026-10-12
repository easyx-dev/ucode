/** marketplace 域的响应模型：市场来源与刷新状态、市场内插件条目 */
import type { PluginSourceInput } from "../plugins/input";
import type { PluginDiagnosticView } from "../plugins/output";

export type MarketplaceView = {
  /** 市场身份，插件 id 的后半段 */
  name: string;
  /** 来源的展示用字面量：目录路径 / url / `owner/repo` */
  source: string;
  /** 随包内置的市场：刷新失败只落 `lastError`，不出用户可见错误 */
  builtin: boolean;
  lastRefreshAt?: string;
  /** 上一次刷新是否成功；从没刷新过为 false */
  refreshedOk: boolean;
  lastError?: string;
  /** 清单里的条目数；没刷新过为 0 */
  pluginCount: number;
};

export type MarketplacesListResponse = {
  marketplaces: MarketplaceView[];
  /** 状态文件绝对路径，供设置页展示与排查 */
  statePath: string;
};

/** 市场登记 / 刷新的统一回执 */
export type MarketplaceWriteResponse = {
  marketplace: MarketplaceView;
  revision: number;
};

export type MarketplaceDeleteResponse = {
  /** 是否命中并移除了登记；目标不存在时报错，故恒为 true */
  removed: boolean;
  /** 被移除市场下已登记的插件 id（只移除登记，不动磁盘内容） */
  orphanedPlugins: string[];
  revision: number;
};

export type MarketplacePluginView = {
  name: string;
  description: string;
  version: string;
  /** 已安装时的插件 id（`<name>@<marketplace>`）；未安装为 null */
  installedId: string | null;
  /** 已安装且可更新；未安装恒为 false */
  updateAvailable: boolean;
  /**
   * 可直接安装的来源（相对路径在刷新时已按市场根解析）；解析不出来时为 null，
   * 界面上的「安装」按钮据此禁用。
   */
  source: PluginSourceInput | null;
};

export type MarketplacePluginsResponse = {
  marketplace: MarketplaceView;
  plugins: MarketplacePluginView[];
  /** 清单里被跳过的条目原因（缺 name、字段非法等）；刷新时随清单缓存在状态里 */
  diagnostics: PluginDiagnosticView[];
};
