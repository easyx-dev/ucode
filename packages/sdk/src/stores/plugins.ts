/** 插件与市场：初次加载，安装 / 启停 / 卸载 / 刷新后由 plugins_changed 控制帧刷新 */
import type {
  MarketplaceCreateRequest,
  MarketplacePluginsResponse,
  MarketplacesListResponse,
  MarketplaceWriteResponse,
  PluginCreateRequest,
  PluginsListResponse,
  PluginUpdateRequest,
  PluginWriteResponse,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type PluginsState = {
  plugins: PluginsListResponse | null;
  marketplaces: MarketplacesListResponse | null;
  /** 按市场名缓存的市场内插件列表：点开才取，刷新市场后清空 */
  catalogs: Record<string, MarketplacePluginsResponse>;
  /** 安装 / 重拉的阶段提示；完成后由 plugins_changed 清空 */
  progress: string | null;
  error: ApiError | null;
};

export type PluginsStore = {
  getState: Store<PluginsState>["getState"];
  subscribe: Store<PluginsState>["subscribe"];
  /** 重取插件与市场两份列表 */
  load: () => Promise<void>;
  /** 市场内插件列表：命中缓存直接给，否则取一次（失败返回 null 并把错误留在 state） */
  catalog: (name: string) => Promise<MarketplacePluginsResponse | null>;
  /** 安装 / 启停 / 重拉：成功返回回执，失败把错误留在 state 里 */
  create: (input: PluginCreateRequest) => Promise<PluginWriteResponse | null>;
  update: (input: PluginUpdateRequest) => Promise<PluginWriteResponse | null>;
  remove: (id: string, purge?: boolean) => Promise<boolean>;
  refresh: (id: string) => Promise<PluginWriteResponse | null>;
  addMarketplace: (input: MarketplaceCreateRequest) => Promise<MarketplaceWriteResponse | null>;
  removeMarketplace: (name: string) => Promise<boolean>;
  refreshMarketplace: (name: string) => Promise<MarketplaceWriteResponse | null>;
};

export const createPluginsStore = (deps: { apis: Apis; events: EventStream }): PluginsStore => {
  const store = createStore<PluginsState>({
    plugins: null,
    marketplaces: null,
    catalogs: {},
    progress: null,
    error: null,
  });

  const load = async (): Promise<void> => {
    try {
      const [plugins, marketplaces] = await Promise.all([
        deps.apis.plugins.list(),
        deps.apis.marketplace.list(),
      ]);
      // 列表重取意味着市场可能变了，市场内插件缓存一并作废
      store.setState(() => ({ plugins, marketplaces, catalogs: {}, progress: null, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  // 控制帧带的是插件列表快照；市场列表随它一起重取（增删市场也会触发这帧）
  deps.events.onEvent((frame) => {
    if (frame.type === "plugin_progress") {
      store.setState((prev) => ({ ...prev, progress: frame.message }));
      return;
    }
    if (frame.type !== "plugins_changed") return;
    store.setState((prev) => ({
      ...prev,
      plugins: frame.plugins,
      catalogs: {},
      progress: null,
      error: null,
    }));
    void deps.apis.marketplace
      .list()
      .then((marketplaces) => store.setState((prev) => ({ ...prev, marketplaces, error: null })))
      .catch((error: unknown) => store.setState((prev) => ({ ...prev, error: asApiError(error) })));
  });

  // 重连补快照：断流期间可能错过 plugins_changed
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void load();
  });

  void load();

  /** 写操作共用：成功即把错误清掉，失败把错误留下并返回 null */
  const run = async <T>(action: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await action();
      store.setState((prev) => ({ ...prev, error: null }));
      return result;
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
      return null;
    }
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    async catalog(name) {
      const cached = store.getState().catalogs[name];
      if (cached) return cached;
      try {
        const data = await deps.apis.marketplace.info(name);
        store.setState((prev) => ({
          ...prev,
          catalogs: { ...prev.catalogs, [name]: data },
          error: null,
        }));
        return data;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
    create: (input) => run(() => deps.apis.plugins.create(input)),
    update: (input) => run(() => deps.apis.plugins.update(input)),
    async remove(id, purge = false) {
      return (await run(() => deps.apis.plugins.remove({ id, purge }))) !== null;
    },
    refresh: (id) => run(() => deps.apis.plugins.refresh(id)),
    addMarketplace: (input) => run(() => deps.apis.marketplace.create(input)),
    async removeMarketplace(name) {
      return (await run(() => deps.apis.marketplace.remove(name))) !== null;
    },
    refreshMarketplace: (name) => run(() => deps.apis.marketplace.refresh(name)),
  };
};
