/**
 * 插件服务：登记表的读写、注册表缓存与变更广播；变更后由会话池按新代次重装内存会话。
 *
 * 安装只支持本地目录来源（`directory`，内容不复制）：url / npm / github / git 需要网络底座与解包，
 * 属市场那一步，本轮一律回 `plugin_source_invalid` 并说明原因，不做静默降级。
 */
import { readFileSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  ERROR_CODES,
  type PluginCreateInput,
  type PluginDeleteInput,
  type PluginDeleteResponse,
  type PluginRefreshInput,
  type PluginsListResponse,
  type PluginUpdateInput,
  type PluginView,
  type PluginWriteResponse,
} from "@ucode/contracts";

import { PLUGIN_DATA_DIRNAME } from "../../constants/dirs";
import type { SessionEventBus } from "../../core/event-bus";
import { env } from "../../env";
import type { PluginHookBinding } from "../../harness/plugins/hooks";
import {
  findManifestFile,
  PLUGIN_NAME_PATTERN,
  type PluginManifest,
  parsePluginManifest,
} from "../../harness/plugins/manifest";
import { buildPluginRegistry } from "../../harness/plugins/registry";
import { toDataDirName } from "../../harness/plugins/sanitize";
import { hashDirectory } from "../../harness/plugins/source-hash";
import {
  type InstalledPluginRecord,
  type PluginSourceSpec,
  type PluginState,
  toPluginId,
} from "../../harness/plugins/state";
import type {
  PluginAgentFile,
  PluginCommandAssets,
  PluginDescriptor,
  PluginRegistry,
} from "../../harness/plugins/types";
import { toPluginView } from "../../harness/plugins/view";
import { isInsidePath, resolveExistingPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import type { PluginStateStore } from "./state";

export type PluginServiceDeps = {
  state: PluginStateStore;
  events: SessionEventBus;
  /** 登记表变更后调用：让内存会话按新代次在空闲后重装（由会话池提供） */
  onRegistryChange?: (revision: number) => void;
  /** 插件根（`purge` 只删它里面的内容）；缺省取 `env.pluginsDir`，测试可覆盖 */
  pluginsDir?: string;
};

export type PluginService = {
  list(): PluginsListResponse;
  /** 当前注册表；按 revision 缓存，变更即失效（不做模块级缓存） */
  registry(): PluginRegistry;
  /** 已启用的登记记录：装配期注入技能 / 命令 / 角色目录时用 */
  enabled(): InstalledPluginRecord[];
  /** 启用插件贡献的技能 / 命令目录：装配期注入与 `/` 菜单共用同一份 */
  commandAssets(): PluginCommandAssets;
  /** 启用插件声明的子角色：角色注册表（装配 + `agents/list`）共用 */
  agentProfiles(): PluginAgentFile[];
  /** 可信来源插件的 pi 扩展路径；第三方市场的扩展不注入（来源门控，见 plans/plugins.md 第五章） */
  extensionPaths(): string[];
  /** 可信来源插件的 bin 目录；第三方市场的不注入 */
  binDirs(): string[];
  /** 可信来源插件的命令式 hook；第三方市场的不挂载 */
  hooks(): PluginHookBinding[];
  /**
   * 重算已装插件的「来源是否已变」：本地目录来源按内容哈希比对，写回 `updateAvailable` 与检查时间。
   * 只在显式动作（刷新市场 / 重拉）里跑——列表接口不做这类扫描。返回结果变化的插件数。
   */
  checkUpdates(): number;
  create(input: PluginCreateInput): PluginWriteResponse;
  update(input: PluginUpdateInput): PluginWriteResponse;
  delete(input: PluginDeleteInput): PluginDeleteResponse;
  refresh(input: PluginRefreshInput): PluginWriteResponse;
};

/** 只接受本地目录来源；其余来源在包拉取落地前明确拒绝，并带上来源名供客户端渲染 */
const assertDirectorySource = (source: PluginSourceSpec): string => {
  if (source.source !== "directory") {
    throw new AppError(
      ERROR_CODES.pluginSourceInvalid,
      `插件来源尚未支持：${source.source}`,
      400,
      undefined,
      { source: source.source },
    );
  }
  return resolveExistingPath(source.path, true);
};

/** 读一次清单：显式安装 / 重拉的路径上清单坏了直接失败（只有发现路径才降级成诊断） */
const readManifestForInstall = (path: string): PluginManifest | null => {
  const file = findManifestFile(path);
  if (!file) return null;
  return parsePluginManifest(readFileSync(file, "utf8"), file);
};

/**
 * 清理磁盘内容：只删我们自己管的东西。`directory` 源指向用户自己的目录，绝不动它；
 * 插件数据目录（`${*_PLUGIN_DATA}`）无条件清理。
 */
const purgeFiles = (record: InstalledPluginRecord, pluginsDir: string): boolean => {
  rmSync(resolve(pluginsDir, PLUGIN_DATA_DIRNAME, toDataDirName(record.id)), {
    recursive: true,
    force: true,
  });
  if (!isInsidePath(pluginsDir, record.path)) return false;
  rmSync(record.path, { recursive: true, force: true });
  return true;
};

export const createPluginService = (deps: PluginServiceDeps): PluginService => {
  const { state, events, onRegistryChange } = deps;
  const pluginsDir = deps.pluginsDir ?? env.pluginsDir;
  let cache: PluginRegistry | null = null;

  const registry = (): PluginRegistry => {
    const current = state.get();
    if (!cache || cache.revision !== current.revision) cache = buildPluginRegistry(current);
    return cache;
  };

  /** 变更收口：推进代次 → 丢缓存 → 让会话按新代次重装 → 广播 */
  const commit = (mutate: (current: PluginState) => PluginState): void => {
    const next = state.update(mutate);
    cache = null;
    onRegistryChange?.(next.revision);
    events.emitControl({
      type: "plugins_changed",
      revision: next.revision,
      plugins: {
        plugins: registry().plugins.map(toPluginView),
        statePath: state.path,
        revision: next.revision,
      },
    });
  };

  /** 本地目录来源的内容哈希；算不出来（不存在 / 超限）时返回 undefined，表示这次不判定 */
  const directoryIntegrity = (source: PluginSourceSpec): string | undefined =>
    source.source === "directory" ? (hashDirectory(source.path)?.hash ?? undefined) : undefined;

  /** 取可信来源插件（`official` / `local`）的某类资产：第三方市场的一律过滤掉 */
  const trustedAssets = (pick: (descriptor: PluginDescriptor) => string[]): string[] => {
    const paths: string[] = [];
    for (const descriptor of registry().plugins) {
      if (!descriptor.enabled || descriptor.source === "market") continue;
      paths.push(...pick(descriptor));
    }
    return [...new Set(paths)];
  };

  const viewOf = (id: string): PluginView => {
    const descriptor = registry().plugins.find((item) => item.id === id);
    if (!descriptor) {
      throw new AppError(ERROR_CODES.pluginNotFound, `插件不存在：${id}`, 404, undefined, { id });
    }
    return toPluginView(descriptor);
  };

  const write = (id: string): PluginWriteResponse => ({
    plugin: viewOf(id),
    revision: state.get().revision,
  });

  return {
    list: () => ({
      plugins: registry().plugins.map(toPluginView),
      statePath: state.path,
      revision: state.get().revision,
    }),
    registry,
    enabled: () => state.get().installed.filter((item) => item.enabled),
    // 技能与命令是资源型组件：任何来源都生效，不参与执行类的来源门控
    commandAssets: () => {
      const skills: string[] = [];
      const prompts: string[] = [];
      for (const descriptor of registry().plugins) {
        if (!descriptor.enabled) continue;
        skills.push(...descriptor.assets.skills);
        prompts.push(...descriptor.assets.prompts);
      }
      return { skills: [...new Set(skills)], prompts: [...new Set(prompts)] };
    },
    agentProfiles: () =>
      registry()
        .plugins.filter((item) => item.enabled)
        .flatMap((item) => item.agents),
    // 执行类组件的来源门控在这里收口：第三方市场的只出诊断，不进装配
    extensionPaths: () => trustedAssets((item) => item.assets.extensions),
    hooks: () => {
      const bindings: PluginHookBinding[] = [];
      for (const descriptor of registry().plugins) {
        if (!descriptor.enabled || descriptor.source === "market") continue;
        bindings.push(...descriptor.hooks);
      }
      return bindings;
    },
    binDirs: () =>
      trustedAssets((item) =>
        item.components
          .filter((entry) => entry.group === "bin" && entry.path)
          .map((entry) => entry.path as string),
      ),

    create(input) {
      const path = assertDirectorySource(input.source);
      const manifest = readManifestForInstall(path);
      const name = manifest?.name ?? basename(path);
      if (!PLUGIN_NAME_PATTERN.test(name)) {
        throw new AppError(
          ERROR_CODES.pluginManifestInvalid,
          `插件名不合法：${name}`,
          400,
          undefined,
          {
            path,
          },
        );
      }
      const marketplace = input.marketplace;
      if (marketplace && !state.get().marketplaces.some((item) => item.name === marketplace)) {
        throw new AppError(
          ERROR_CODES.marketplaceInvalid,
          `市场未登记：${marketplace}`,
          400,
          undefined,
          {
            reason: marketplace,
          },
        );
      }
      const id = toPluginId(name, marketplace);
      if (state.get().installed.some((item) => item.id === id)) {
        throw new AppError(ERROR_CODES.invalidRequest, `插件已登记：${id}`, 400, undefined, { id });
      }

      commit((current) => ({
        ...current,
        installed: [
          ...current.installed,
          {
            id,
            name,
            version: manifest?.version?.trim() || "0.0.0",
            source: input.source,
            ...(marketplace ? { marketplace } : {}),
            path,
            scope: input.scope,
            enabled: input.enabled,
            installedAt: new Date().toISOString(),
            // 本地目录来源记内容哈希：它是后续「来源已变」判定的基线
            ...(directoryIntegrity(input.source) === undefined
              ? {}
              : { integrity: directoryIntegrity(input.source) as string }),
            updateAvailable: false,
            checkedAt: new Date().toISOString(),
          },
        ],
      }));
      return write(id);
    },

    checkUpdates() {
      const now = new Date().toISOString();
      let changed = 0;
      const next = state.get().installed.map((item) => {
        const integrity = directoryIntegrity(item.source);
        if (integrity === undefined) return item;
        const updateAvailable = item.integrity !== undefined && item.integrity !== integrity;
        if (updateAvailable && item.updateAvailable !== true) changed += 1;
        return { ...item, updateAvailable, checkedAt: now };
      });
      // 结论有变化才推进代次：否则每次刷新市场都会把内存会话打回一轮
      if (changed > 0) commit((current) => ({ ...current, installed: next }));
      else state.set({ ...state.get(), installed: next });
      return changed;
    },

    update(input) {
      const record = state.requirePlugin(input.id);
      commit((current) => ({
        ...current,
        installed: current.installed.map((item) =>
          item.id !== record.id
            ? item
            : {
                ...item,
                ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
                ...(input.config === undefined
                  ? {}
                  : { config: { ...item.config, ...input.config } }),
              },
        ),
      }));
      return write(record.id);
    },

    delete(input) {
      const record = state.requirePlugin(input.id);
      const purged = input.purge ? purgeFiles(record, pluginsDir) : false;
      commit((current) => ({
        ...current,
        installed: current.installed.filter((item) => item.id !== record.id),
      }));
      return { removed: true, purged, revision: state.get().revision };
    },

    refresh(input) {
      const record = state.requirePlugin(input.id);
      const path = assertDirectorySource(record.source);
      const manifest = readManifestForInstall(path);
      const integrity = directoryIntegrity(record.source);
      commit((current) => ({
        ...current,
        installed: current.installed.map((item) =>
          item.id !== record.id
            ? item
            : {
                ...item,
                path,
                ...(manifest?.name ? { name: manifest.name } : {}),
                ...(manifest?.version ? { version: manifest.version } : {}),
                ...(integrity === undefined ? {} : { integrity }),
                updateAvailable: false,
                checkedAt: new Date().toISOString(),
              },
        ),
      }));
      return write(record.id);
    },
  };
};

export { PluginStateStore } from "./state";
