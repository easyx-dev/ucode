/** 插件与市场的 React 绑定：状态与写操作都在 SDK plugins store，失败由 ErrorToaster 统一提示 */
import type {
  MarketplaceCreateRequest,
  MarketplacePluginsResponse,
  MarketplacesListResponse,
  PluginCreateRequest,
  PluginsListResponse,
  PluginUpdateRequest,
} from "@ucode/contracts";

import { useEffect } from "react";
import { useClient } from "../../provider";
import { useStore } from "../use-store";

export function usePlugins(cwd: string | null = null): {
  plugins: PluginsListResponse | null;
  /** 安装 / 重拉的阶段提示（来自 plugin_progress 帧），完成后自动清空 */
  progress: string | null;
  marketplaces: MarketplacesListResponse | null;
  install: (input: PluginCreateRequest) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  setConfig: (id: string, config: Record<string, string | number | boolean>) => Promise<boolean>;
  uninstall: (id: string, purge?: boolean) => Promise<boolean>;
  refresh: (id: string) => Promise<boolean>;
  addMarketplace: (input: MarketplaceCreateRequest) => Promise<boolean>;
  removeMarketplace: (name: string) => Promise<boolean>;
  refreshMarketplace: (name: string) => Promise<boolean>;
  /** 市场内插件列表：点开才取 */
  catalog: (name: string) => Promise<MarketplacePluginsResponse | null>;
} {
  const client = useClient();
  const state = useStore(client.plugins);

  // 工作目录变化（切会话 / 切仓库）要按新 cwd 重取一次：生效开关可能被项目覆盖翻掉
  useEffect(() => {
    void client.plugins.load(cwd);
  }, [client, cwd]);

  return {
    plugins: state.plugins,
    progress: state.progress,
    marketplaces: state.marketplaces,
    install: async (input) => (await client.plugins.create(input)) !== null,
    setEnabled: async (id: string, enabled: boolean) => {
      const body: PluginUpdateRequest = { id, enabled };
      return (await client.plugins.update(body)) !== null;
    },
    setConfig: async (id, config) => (await client.plugins.update({ id, config })) !== null,
    uninstall: (id, purge = false) => client.plugins.remove(id, purge),
    refresh: async (id: string) => (await client.plugins.refresh(id)) !== null,
    addMarketplace: async (input) => (await client.plugins.addMarketplace(input)) !== null,
    removeMarketplace: (name) => client.plugins.removeMarketplace(name),
    refreshMarketplace: async (name) => (await client.plugins.refreshMarketplace(name)) !== null,
    catalog: (name: string) => client.plugins.catalog(name),
  };
}
