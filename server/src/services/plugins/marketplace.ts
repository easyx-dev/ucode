/**
 * 市场服务：市场来源的登记、移除与刷新。
 *
 * 本轮只实现**本地目录市场**的清单读取：登记时校验目录存在，刷新时读 `marketplace.json` 并记条目数；
 * url / github / git 来源在公共网络底座落地前一律按「来源尚未支持」处理——内置市场（如
 * `claude-plugins-official`）失败只落 `lastError`，用户显式刷新则把失败报出去。
 */

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ERROR_CODES,
  type MarketplaceCreateInput,
  type MarketplaceDeleteInput,
  type MarketplaceDeleteResponse,
  type MarketplaceInfoInput,
  type MarketplacePluginsResponse,
  type MarketplaceRefreshInput,
  type MarketplacesListResponse,
  type MarketplaceView,
  type MarketplaceWriteResponse,
} from "@ucode/contracts";
import { PLUGIN_MARKETPLACES_DIRNAME } from "../../constants/dirs";
import {
  PLUGIN_FETCH_TIMEOUT_MS,
  PLUGIN_GIT_TIMEOUT_MS,
  PLUGIN_MARKETPLACE_MAX_BYTES,
} from "../../constants/plugins";
import type { SessionEventBus } from "../../core/event-bus";
import { env } from "../../env";
import { describeError } from "../../harness/plugins/diagnostic";
import {
  type MarketplaceCatalogEntry,
  parseMarketplaceCatalog,
  readMarketplaceCatalog,
} from "../../harness/plugins/marketplace";
import { hashDirectory } from "../../harness/plugins/source-hash";
import type {
  PluginMarketplaceRecord,
  PluginSourceSpec,
  PluginState,
} from "../../harness/plugins/state";
import { type PublicFetchResult, publicFetch } from "../../platform/net";
import { resolveExistingPath, resolveTargetPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import { SourceError, type SourceRunner } from "./sources";
import type { PluginStateStore } from "./state";

export type MarketplaceServiceDeps = {
  state: PluginStateStore;
  events: SessionEventBus;
  /** 市场增删会影响插件的来源档位判定，故同样触发会话按新代次重装 */
  onRegistryChange?: (revision: number) => void;
  /** 清单刷新成功后顺带重算已装插件的「来源是否已变」（由插件服务提供） */
  onCatalogRefreshed?: () => Promise<number>;
  /** 出网取流（url 市场）；测试可替换 */
  fetch?: (input: Parameters<typeof publicFetch>[0]) => Promise<PublicFetchResult>;
  /** 进程调用（git 市场）；测试可替换 */
  run?: SourceRunner;
  /** 插件根：市场仓库的克隆副本落在 `marketplaces/<market>` 下 */
  pluginsDir?: string;
};

/** 状态里缓存的条目：来源已解析成 PluginSourceSpec（解析不出来则缺省） */
type ResolvedCatalogEntry = {
  name: string;
  description: string;
  version: string;
  source?: PluginSourceSpec;
};

/** 默认的进程调用：与来源拉取同一套（execa） */
const defaultSourceRunner: SourceRunner = async (file, args, options) => {
  const { execa } = await import("execa");
  const result = await execa(file, args, { timeout: options.timeout, reject: true });
  return { stdout: typeof result.stdout === "string" ? result.stdout : "" };
};

export type MarketplaceService = {
  /** 市场内插件列表：读状态里缓存的条目（列接口不打网络、不扫盘） */
  info(input: MarketplaceInfoInput): MarketplacePluginsResponse;
  list(): MarketplacesListResponse;
  create(input: MarketplaceCreateInput): MarketplaceWriteResponse;
  delete(input: MarketplaceDeleteInput): MarketplaceDeleteResponse;
  refresh(input: MarketplaceRefreshInput): Promise<MarketplaceWriteResponse>;
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
  const { state, events, onRegistryChange, onCatalogRefreshed } = deps;

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

  /**
   * 解析条目来源：相对路径按市场根解析成绝对路径（目录 / git 克隆副本都能对）；
   * url 市场里的相对路径没有可解析的根，直接放弃（能看不能一键装）。
   */
  const resolveEntrySources = (
    entries: readonly MarketplaceCatalogEntry[],
    root: string | null,
  ): ResolvedCatalogEntry[] =>
    entries.map((entry) => {
      if (!entry.source) {
        return { name: entry.name, description: entry.description, version: entry.version };
      }
      if (entry.source.kind === "explicit") {
        return {
          name: entry.name,
          description: entry.description,
          version: entry.version,
          source: entry.source.source,
        };
      }
      // 相对路径：本地 / git 市场按市场根落成绝对路径；url 市场没有根，只能「能看不能装」
      if (!root)
        return { name: entry.name, description: entry.description, version: entry.version };
      return {
        name: entry.name,
        description: entry.description,
        version: entry.version,
        source: { source: "directory", path: resolve(root, entry.source.path) },
      };
    });

  /** 刷新结果写回：成功时清掉上一次的 `lastError` */
  const recordRefresh = (
    name: string,
    patch: {
      lastError?: string;
      pluginCount?: number;
      refreshedOk: boolean;
      etag?: string | null;
      lastModified?: string | null;
      integrity?: string;
      catalog?: ResolvedCatalogEntry[];
    },
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
          ...(patch.etag ? { etag: patch.etag } : {}),
          ...(patch.lastModified ? { lastModified: patch.lastModified } : {}),
          ...(patch.integrity === undefined ? {} : { integrity: patch.integrity }),
          ...(patch.catalog === undefined ? {} : { catalog: patch.catalog }),
        };
      }),
    }));
  };

  /** 网络来源失败：用户显式刷新时报错，内置市场静默记账 */
  const reportSourceFailure = (record: PluginMarketplaceRecord, error: unknown): void => {
    if (!record.builtin) throw error;
    recordRefresh(record.name, { refreshedOk: false, lastError: describeError(error) });
  };

  /** url 市场：条件请求取清单；304 视为未变 */
  const refreshUrlMarket = async (
    record: PluginMarketplaceRecord,
    source: Extract<PluginMarketplaceRecord["source"], { source: "url" }>,
  ): Promise<void> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (record.etag) headers["if-none-match"] = record.etag;
    if (record.lastModified) headers["if-modified-since"] = record.lastModified;

    const response = await (deps.fetch ?? publicFetch)({
      url: source.url,
      headers,
      maxBytes: PLUGIN_MARKETPLACE_MAX_BYTES,
      timeoutMs: PLUGIN_FETCH_TIMEOUT_MS,
    });

    if (response.status === 304) {
      recordRefresh(record.name, {
        refreshedOk: true,
        pluginCount: record.pluginCount,
        catalog: record.catalog,
      });
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AppError(
        ERROR_CODES.marketplaceInvalid,
        `市场清单取不到：HTTP ${response.status} ${response.url.href}`,
        400,
        undefined,
        { reason: `HTTP ${response.status}` },
      );
    }

    const catalog = parseMarketplaceCatalog(
      new TextDecoder().decode(response.body),
      record.name,
      response.url.href,
    );
    recordRefresh(record.name, {
      refreshedOk: true,
      pluginCount: catalog.entries.length,
      // url 市场没有本地根：相对路径条目解析不了，留着「能看不能装」
      catalog: resolveEntrySources(catalog.entries, null),
      etag: response.etag,
      lastModified: response.lastModified,
      integrity: createHash("sha256").update(response.body).digest("hex"),
    });
  };

  /** git / github 市场：浅克隆到 `marketplaces/<market>`，清单取克隆副本的仓根 */
  const refreshGitMarket = async (
    record: PluginMarketplaceRecord,
    source: Extract<PluginMarketplaceRecord["source"], { source: "git" | "github" }>,
  ): Promise<void> => {
    const run = deps.run ?? defaultSourceRunner;
    const root = resolve(deps.pluginsDir ?? env.pluginsDir, PLUGIN_MARKETPLACES_DIRNAME);
    const target = join(root, record.name);
    const staging = join(root, `${record.name}.staging`);

    const url = source.source === "git" ? source.url : `https://github.com/${source.repo}.git`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(dirname(staging), { recursive: true });
    try {
      const args = ["clone", "--depth", "1"];
      if (source.ref) args.push("--branch", source.ref);
      args.push(url, staging);
      await run("git", args, { timeout: PLUGIN_GIT_TIMEOUT_MS });
      rmSync(target, { recursive: true, force: true });
      renameSync(staging, target);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error instanceof Error ? error : new SourceError(String(error));
    }

    const catalog = readMarketplaceCatalog(target, record.name);
    recordRefresh(record.name, {
      refreshedOk: true,
      pluginCount: catalog.entries.length,
      catalog: resolveEntrySources(catalog.entries, target),
      integrity: hashDirectory(target)?.hash,
    });
  };

  return {
    info(input) {
      const record = requireMarketplace(input.name);
      const installedByName = new Map(
        state
          .get()
          .installed.filter((item) => item.marketplace === record.name)
          .map((item) => [item.name, item]),
      );

      return {
        marketplace: toView(record),
        plugins: (record.catalog ?? []).map((entry) => {
          const installed = installedByName.get(entry.name);
          return {
            name: entry.name,
            description: entry.description,
            version: entry.version,
            installedId: installed?.id ?? null,
            updateAvailable: installed?.updateAvailable === true,
            source: entry.source ?? null,
          };
        }),
        diagnostics: [],
      };
    },

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

    async refresh(input) {
      const record = requireMarketplace(input.name);
      const source = record.source;

      try {
        if (source.source === "directory") {
          const marketDir = resolveTargetPath(source.path);
          const catalog = readMarketplaceCatalog(marketDir, record.name);
          recordRefresh(record.name, {
            refreshedOk: true,
            pluginCount: catalog.entries.length,
            catalog: resolveEntrySources(catalog.entries, marketDir),
            integrity: hashDirectory(marketDir)?.hash,
          });
        } else if (source.source === "url") {
          await refreshUrlMarket(record, source);
        } else if (source.source === "git" || source.source === "github") {
          await refreshGitMarket(record, source);
        } else {
          throw new AppError(
            ERROR_CODES.marketplaceInvalid,
            `市场来源尚未支持：${source.source}`,
            400,
            undefined,
            { reason: source.source },
          );
        }
        // 刷新市场是「显式检查更新」的入口：顺手把已装插件的来源变动算出来
        await onCatalogRefreshed?.();
      } catch (error) {
        // 用户显式刷新把失败报出去；内置市场只记账，不打扰
        reportSourceFailure(record, error);
      }
      return {
        marketplace: toView(requireMarketplace(record.name)),
        revision: state.get().revision,
      };
    },
  };
};
