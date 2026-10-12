/** 插件与市场的 React 绑定：状态与写操作都在 SDK plugins store，失败由 ErrorToaster 统一提示 */
import type {
  MarketplaceCreateRequest,
  MarketplacesListResponse,
  PluginCreateRequest,
  PluginsListResponse,
  PluginUpdateRequest,
} from "@ucode/contracts";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function usePlugins(): {
  plugins: PluginsListResponse | null;
  marketplaces: MarketplacesListResponse | null;
  install: (input: PluginCreateRequest) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  uninstall: (id: string, purge?: boolean) => Promise<boolean>;
  refresh: (id: string) => Promise<boolean>;
  addMarketplace: (input: MarketplaceCreateRequest) => Promise<boolean>;
  removeMarketplace: (name: string) => Promise<boolean>;
  refreshMarketplace: (name: string) => Promise<boolean>;
} {
  const client = useClient();
  const state = useStore(client.plugins);

  return {
    plugins: state.plugins,
    marketplaces: state.marketplaces,
    install: async (input) => (await client.plugins.create(input)) !== null,
    setEnabled: async (id: string, enabled: boolean) => {
      const body: PluginUpdateRequest = { id, enabled };
      return (await client.plugins.update(body)) !== null;
    },
    uninstall: (id, purge = false) => client.plugins.remove(id, purge),
    refresh: async (id: string) => (await client.plugins.refresh(id)) !== null,
    addMarketplace: async (input) => (await client.plugins.addMarketplace(input)) !== null,
    removeMarketplace: (name) => client.plugins.removeMarketplace(name),
    refreshMarketplace: async (name) => (await client.plugins.refreshMarketplace(name)) !== null,
  };
}
