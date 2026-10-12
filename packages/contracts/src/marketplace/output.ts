/** marketplace 域的响应模型：市场来源与刷新状态、市场内插件条目 */
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

export type MarketplacePluginView = {
  name: string;
  description: string;
  version: string;
  /** 已安装时的插件 id（`<name>@<marketplace>`）；未安装为 null */
  installedId: string | null;
  /** 已安装且可更新；未安装恒为 false */
  updateAvailable: boolean;
};

export type MarketplacePluginsResponse = {
  marketplace: MarketplaceView;
  plugins: MarketplacePluginView[];
  /** 清单里被跳过的条目原因（来源不被支持、字段非法等） */
  diagnostics: PluginDiagnosticView[];
};
