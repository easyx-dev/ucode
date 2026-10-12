/**
 * 市场服务：市场来源的登记、移除与刷新。
 *
 * 本轮只实现**本地目录市场**的清单读取：登记时校验目录存在，刷新时读 `marketplace.json` 并记条目数；
 * url / github / git 来源在公共网络底座落地前一律按「来源尚未支持」处理——内置市场（如
 * `claude-plugins-official`）失败只落 `lastError`，用户显式刷新则把失败报出去。
 */
import {
  ERROR_CODES,
  type MarketplaceCreateInput,
  type MarketplaceDeleteInput,
  type MarketplaceDeleteResponse,
  type MarketplaceRefreshInput,
  type MarketplacesListResponse,
  type MarketplaceView,
  type MarketplaceWriteResponse,
} from "@ucode/contracts";

import type { SessionEventBus } from "../../core/event-bus";
import { describeError } from "../../harness/plugins/diagnostic";
import { readMarketplaceCatalog } from "../../harness/plugins/marketplace";
import type {
  PluginMarketplaceRecord,
  PluginSourceSpec,
  PluginState,
} from "../../harness/plugins/state";
import { resolveExistingPath, resolveTargetPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import type { PluginStateStore } from "./state";

export type MarketplaceServiceDeps = {
  state: PluginStateStore;
  events: SessionEventBus;
  /** 市场增删会影响插件的来源档位判定，故同样触发会话按新代次重装 */
  onRegistryChange?: (revision: number) => void;
};

export type MarketplaceService = {
  list(): MarketplacesListResponse;
  create(input: MarketplaceCreateInput): MarketplaceWriteResponse;
  delete(input: MarketplaceDeleteInput): MarketplaceDeleteResponse;
  refresh(input: MarketplaceRefreshInput): MarketplaceWriteResponse;
};

/** 来源的展示用字面量：设置页只读它，不 parse 结构 */
const sourceLabel = (source: PluginSourceSpec): string => {
  switch (source.source) {
    case "directory":
      return source.path;
    case "url":
      return source.url;
    case "npm":
      return source.package;
    case "github":
      return source.repo;
    case "git":
      return source.url;
    default:
      return "unknown";
  }
};

const toView = (record: PluginMarketplaceRecord): MarketplaceView => ({
  name: record.name,
  source: sourceLabel(record.source),
  builtin: record.builtin,
  ...(record.lastRefreshAt ? { lastRefreshAt: record.lastRefreshAt } : {}),
  refreshedOk: record.refreshedOk,
  ...(record.lastError ? { lastError: record.lastError } : {}),
  pluginCount: record.pluginCount,
});

export const createMarketplaceService = (deps: MarketplaceServiceDeps): MarketplaceService => {
  const { state, events, onRegistryChange } = deps;

  const requireMarketplace = (name: string): PluginMarketplaceRecord => {
    const record = state.get().marketplaces.find((item) => item.name === name);
    if (!record) {
      throw new AppError(ERROR_CODES.marketplaceInvalid, `市场不存在：${name}`, 404, undefined, {
        reason: name,
      });
    }
    return record;
  };

  const commit = (mutate: (current: PluginState) => PluginState): void => {
    const next = state.update(mutate);
    onRegistryChange?.(next.revision);
    events.emitControl({
      type: "plugins_changed",
      revision: next.revision,
      plugins: {
        plugins: [],
        statePath: state.path,
        revision: next.revision,
      },
    });
  };

  /** 刷新结果写回：成功时清掉上一次的 `lastError` */
  const recordRefresh = (
    name: string,
    patch: { lastError?: string; pluginCount?: number; refreshedOk: boolean },
  ): void => {
    commit((current) => ({
      ...current,
      marketplaces: current.marketplaces.map((item) => {
        if (item.name !== name) return item;
        const { lastError: _previous, ...rest } = item;
        return {
          ...rest,
          refreshedOk: patch.refreshedOk,
          lastRefreshAt: new Date().toISOString(),
          ...(patch.pluginCount === undefined ? {} : { pluginCount: patch.pluginCount }),
          ...(patch.lastError === undefined ? {} : { lastError: patch.lastError }),
        };
      }),
    }));
  };

  /** 网络来源尚不可用：用户显式刷新时报错，内置市场静默记账 */
  const reportUnsupportedSource = (record: PluginMarketplaceRecord): void => {
    const error = new AppError(
      ERROR_CODES.marketplaceInvalid,
      `市场来源尚未支持：${record.source.source}`,
      400,
      undefined,
      { reason: record.source.source },
    );
    if (!record.builtin) throw error;
    recordRefresh(record.name, { refreshedOk: false, lastError: describeError(error) });
  };

  return {
    list: () => ({
      marketplaces: state.get().marketplaces.map(toView),
      statePath: state.path,
    }),

    create(input) {
      if (state.get().marketplaces.some((item) => item.name === input.name)) {
        throw new AppError(
          ERROR_CODES.invalidRequest,
          `市场已登记：${input.name}`,
          400,
          undefined,
          {
            name: input.name,
          },
        );
      }
      // 本地目录必须存在；清单内容留给刷新时校验（登记本身不等于读清单）
      if (input.source.source === "directory") resolveExistingPath(input.source.path, true);

      commit((current) => ({
        ...current,
        marketplaces: [
          ...current.marketplaces,
          {
            name: input.name,
            source: input.source,
            builtin: false,
            refreshedOk: false,
            pluginCount: 0,
          },
        ],
      }));
      return {
        marketplace: toView(requireMarketplace(input.name)),
        revision: state.get().revision,
      };
    },

    delete(input) {
      const record = requireMarketplace(input.name);
      const orphanedPlugins = state
        .get()
        .installed.filter((item) => item.marketplace === record.name)
        .map((item) => item.id);
      commit((current) => ({
        ...current,
        marketplaces: current.marketplaces.filter((item) => item.name !== record.name),
      }));
      return { removed: true, orphanedPlugins, revision: state.get().revision };
    },

    refresh(input) {
      const record = requireMarketplace(input.name);
      if (record.source.source !== "directory") {
        reportUnsupportedSource(record);
        return {
          marketplace: toView(requireMarketplace(record.name)),
          revision: state.get().revision,
        };
      }

      try {
        const catalog = readMarketplaceCatalog(resolveTargetPath(record.source.path), record.name);
        recordRefresh(record.name, { refreshedOk: true, pluginCount: catalog.entries.length });
      } catch (error) {
        // 用户显式刷新：把失败报出去；内置市场只记账，不打扰
        if (!record.builtin) throw error;
        recordRefresh(record.name, { refreshedOk: false, lastError: describeError(error) });
      }
      return {
        marketplace: toView(requireMarketplace(record.name)),
        revision: state.get().revision,
      };
    },
  };
};
