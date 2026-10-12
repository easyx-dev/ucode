/**
 * 插件服务：登记表的读写、注册表缓存与变更广播；变更后由会话池按新代次重装内存会话。
 *
 * 安装来源分五档（本地目录 / url / npm / github / git），包拉取与解包在 `sources/`；
 * `directory` 来源不复制内容，其余来源落 `cache/<市场>/<插件>/<版本>`。
 */
import { readFileSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import {
  ERROR_CODES,
  type PluginCreateInput,
  type PluginDeleteInput,
  type PluginDeleteResponse,
  type PluginListInput,
  type PluginRefreshInput,
  type PluginsListResponse,
  type PluginUpdateInput,
  type PluginView,
  type PluginWriteResponse,
} from "@ucode/contracts";

import { PLUGIN_CACHE_DIRNAME, PLUGIN_DATA_DIRNAME } from "../../constants/dirs";
import type { SessionEventBus } from "../../core/event-bus";
import { env } from "../../env";
import type { PluginHookBinding } from "../../harness/plugins/hooks";
import type { PluginUserConfigField } from "../../harness/plugins/manifest";
import {
  findManifestFile,
  PLUGIN_NAME_PATTERN,
  type PluginManifest,
  parsePluginManifest,
} from "../../harness/plugins/manifest";
import type { PluginMcpServer } from "../../harness/plugins/mcp";
import { buildPluginRegistry } from "../../harness/plugins/registry";
import { toDataDirName } from "../../harness/plugins/sanitize";
import { hashDirectory } from "../../harness/plugins/source-hash";
import {
  type InstalledPluginRecord,
  LOCAL_MARKETPLACE_NAME,
  type LoadedProjectOverrides,
  type PluginSourceSpec,
  type PluginState,
  pluginSwitchOf,
  toPluginId,
} from "../../harness/plugins/state";
import type {
  PluginAgentFile,
  PluginCommandAssets,
  PluginDescriptor,
  PluginRegistry,
} from "../../harness/plugins/types";
import { toPluginView } from "../../harness/plugins/view";
import { logger } from "../../platform/logger";
import { type PublicFetchResult, publicFetch } from "../../platform/net";
import { resolveExistingPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import { defaultSourceRunner, type SourceRunner, stagePluginSource } from "./sources";
import type { PluginStateStore } from "./state";
import { createPluginStorage } from "./storage";
import { checkSourceUpdate } from "./updates";

export type PluginServiceDeps = {
  state: PluginStateStore;
  events: SessionEventBus;
  /** 登记表变更后调用：让内存会话按新代次在空闲后重装（由会话池提供） */
  onRegistryChange?: (revision: number) => void;
  /** 插件根（`purge` 只删它里面的内容）；缺省取 `env.pluginsDir`，测试可覆盖 */
  pluginsDir?: string;
  /** 进程调用（拉取来源的 git / npm、检查更新的 git ls-remote / npm view）；测试可替换 */
  run?: SourceRunner;
  /** 检查更新用的出网取流（url 来源的条件请求）；测试可替换 */
  fetch?: (input: Parameters<typeof publicFetch>[0]) => Promise<PublicFetchResult>;
};

export type PluginService = {
  /** 列表；给 `cwd` 时 `enabled` / `enabledBy` 是**该仓库里的生效值** */
  list(input?: PluginListInput): PluginsListResponse;
  /** 当前注册表；按 revision 缓存，变更即失效（不做模块级缓存） */
  registry(): PluginRegistry;
  /** 启用插件贡献的技能 / 命令目录：装配期注入与 `/` 菜单共用同一份 */
  commandAssets(cwd?: string): PluginCommandAssets;
  /** 启用插件声明的子角色：角色注册表（装配 + `agents/list`）共用 */
  agentProfiles(cwd?: string): PluginAgentFile[];
  /** 可信来源插件的 pi 扩展路径；第三方市场的扩展不注入（来源门控，见 plans/plugins.md 第五章） */
  extensionPaths(cwd?: string): string[];
  /** 可信来源插件的 bin 目录；第三方市场的不注入 */
  binDirs(cwd?: string): string[];
  /** 可信来源插件的命令式 hook；第三方市场的不挂载 */
  hooks(cwd?: string): PluginHookBinding[];
  /** 启用插件声明的 MCP 服务器：任何来源都生效，能否挂上由会话能力决定 */
  mcpServers(cwd?: string): PluginMcpServer[];
  /**
   * 重算已装插件的「来源是否已变」：本地目录来源按内容哈希比对，写回 `updateAvailable` 与检查时间。
   * 只在显式动作（刷新市场 / 重拉）里跑——列表接口不做这类扫描。返回结果变化的插件数。
   */
  checkUpdates(): Promise<number>;
  create(input: PluginCreateInput): Promise<PluginWriteResponse>;
  update(input: PluginUpdateInput): PluginWriteResponse;
  delete(input: PluginDeleteInput): PluginDeleteResponse;
  refresh(input: PluginRefreshInput): Promise<PluginWriteResponse>;
};

/** 校验 userConfig 的值：只认清单声明过的键，类型按声明收敛（未知键是笔误，不能静默存下来） */
const assertUserConfig = (
  fields: readonly PluginUserConfigField[],
  values: Record<string, string | number | boolean>,
): void => {
  const declared = new Map(fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(values)) {
    const field = declared.get(key);
    if (!field) {
      throw new AppError(ERROR_CODES.invalidRequest, `未声明的配置项：${key}`, 400, undefined, {
        key,
      });
    }
    const actual = typeof value;
    const expected =
      field.type === "select" || field.type === "directory" || field.type === "file"
        ? "string"
        : field.type;
    if (actual !== expected) {
      throw new AppError(
        ERROR_CODES.invalidRequest,
        `配置项 ${key} 需要 ${expected}，收到 ${actual}`,
        400,
        undefined,
        { key },
      );
    }
  }
};

/**
 * 拉取站点的失败是用户可修的（地址错、包格式不对、命令失败），必须落成 400 的
 * `plugin_source_invalid` 而不是让 `app.onError` 兜成 500——界面上那句「服务内部错误」没有指向性。
 */
const asSourceFailure = (error: unknown, source: PluginSourceSpec): never => {
  if (error instanceof AppError) throw error;
  throw new AppError(
    ERROR_CODES.pluginSourceInvalid,
    error instanceof Error ? error.message : String(error),
    400,
    undefined,
    { source: source.source },
  );
};

/** 包拉取：把来源站点的异常统一转成契约里的来源错误 */
const stageOrFail = async (
  input: Parameters<typeof stagePluginSource>[0],
): Promise<Awaited<ReturnType<typeof stagePluginSource>>> => {
  try {
    return await stagePluginSource(input);
  } catch (error) {
    return asSourceFailure(error, input.source);
  }
};

/** 读一次清单：显式安装 / 重拉的路径上清单坏了直接失败（只有发现路径才降级成诊断） */
const readManifestForInstall = (path: string): PluginManifest | null => {
  const file = findManifestFile(path);
  if (!file) return null;
  return parsePluginManifest(readFileSync(file, "utf8"), file);
};

export const createPluginService = (deps: PluginServiceDeps): PluginService => {
  const { state, events, onRegistryChange } = deps;
  const pluginsDir = deps.pluginsDir ?? env.pluginsDir;
  const storage = createPluginStorage({ pluginsDir });
  let cache: PluginRegistry | null = null;

  /** 生效开关判定：描述符与登记记录都只带 `id` / `enabled`，形状够用 */
  const isOn = (plugin: { id: string; enabled: boolean }, cwd?: string): boolean =>
    pluginSwitchOf(plugin, storage.overridesFor(cwd)).enabled;
  /** 清扫前提：还有已装插件（一个都不装时留着现场） */
  const hasInstalled = (): boolean => state.get().installed.length > 0;

  const registry = (): PluginRegistry => {
    const current = state.get();
    if (!cache || cache.revision !== current.revision) {
      cache = buildPluginRegistry(current, (id) =>
        resolve(pluginsDir, PLUGIN_DATA_DIRNAME, toDataDirName(id)),
      );
    }
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
      // 帧是全局的（没有 cwd），带的是用户级开关；客户端拿到后再按自己的 cwd 重取一次
      plugins: {
        plugins: registry().plugins.map((descriptor) =>
          toPluginView(descriptor, pluginSwitchOf(descriptor, null)),
        ),
        statePath: state.path,
        revision: next.revision,
        overrides: null,
      },
    });
  };

  /** 复制型来源的暂存根：按市场分目录，装完即清理（成功与失败都要） */
  /** 本地目录来源的内容哈希；算不出来（不存在 / 超限）时返回 undefined，表示这次不判定 */
  const directoryIntegrity = (source: PluginSourceSpec): string | undefined =>
    source.source === "directory" ? (hashDirectory(source.path)?.hash ?? undefined) : undefined;

  /** 取可信来源插件（`official` / `local`）的某类资产：第三方市场的一律过滤掉 */
  const trustedAssets = (
    pick: (descriptor: PluginDescriptor) => string[],
    cwd?: string,
  ): string[] => {
    const paths: string[] = [];
    for (const descriptor of registry().plugins) {
      if (!isOn(descriptor, cwd) || descriptor.source === "market") continue;
      paths.push(...pick(descriptor));
    }
    return [...new Set(paths)];
  };

  /** 安装 / 重拉的阶段提示：界面靠它显示一行进度，完成由随后的 `plugins_changed` 表示 */
  const announceProgress = (message: string): void => {
    events.emitControl({ type: "plugin_progress", message });
  };

  const viewOf = (id: string): PluginView => {
    const descriptor = registry().plugins.find((item) => item.id === id);
    if (!descriptor) {
      throw new AppError(ERROR_CODES.pluginNotFound, `插件不存在：${id}`, 404, undefined, { id });
    }
    return toPluginView(descriptor, pluginSwitchOf(descriptor, null));
  };

  const write = (id: string): PluginWriteResponse => ({
    plugin: viewOf(id),
    revision: state.get().revision,
  });

  // 启动先扫一次：上次退出后可能已经过了保留期
  storage.sweepOrphans("startup", hasInstalled());

  return {
    list: (input) => {
      const overrides = storage.overridesFor(input?.cwd);
      return {
        plugins: registry().plugins.map((descriptor) =>
          toPluginView(descriptor, pluginSwitchOf(descriptor, overrides)),
        ),
        statePath: state.path,
        revision: state.get().revision,
        overrides: overrides
          ? {
              projectPath: overrides.projectPath,
              localPath: overrides.localPath,
              diagnostics: overrides.diagnostics,
            }
          : null,
      };
    },
    registry,
    // 技能与命令是资源型组件：任何来源都生效，不参与执行类的来源门控
    commandAssets: (cwd) => {
      const skills: string[] = [];
      const prompts: string[] = [];
      for (const descriptor of registry().plugins) {
        if (!isOn(descriptor, cwd)) continue;
        skills.push(...descriptor.assets.skills);
        prompts.push(...descriptor.assets.prompts);
      }
      return { skills: [...new Set(skills)], prompts: [...new Set(prompts)] };
    },
    agentProfiles: (cwd) =>
      registry()
        .plugins.filter((item) => isOn(item, cwd))
        .flatMap((item) => item.agents),
    // 执行类组件的来源门控在这里收口：第三方市场的只出诊断，不进装配
    extensionPaths: (cwd) => trustedAssets((item) => item.assets.extensions, cwd),
    hooks: (cwd) => {
      const bindings: PluginHookBinding[] = [];
      for (const descriptor of registry().plugins) {
        if (!isOn(descriptor, cwd) || descriptor.source === "market") continue;
        bindings.push(...descriptor.hooks);
      }
      return bindings;
    },
    mcpServers: (cwd) =>
      registry()
        .plugins.filter((item) => isOn(item, cwd))
        .flatMap((item) => item.mcpServers),
    binDirs: (cwd) =>
      trustedAssets(
        (item) =>
          item.components
            .filter((entry) => entry.group === "bin" && entry.path)
            .map((entry) => entry.path as string),
        cwd,
      ),
    async checkUpdates() {
      const now = new Date().toISOString();
      const records = state.get().installed;
      const checked = await Promise.all(
        records.map(async (item) => {
          try {
            return await checkSourceUpdate({
              record: item,
              at: now,
              run: deps.run ?? defaultSourceRunner,
              fetch: deps.fetch ?? publicFetch,
            });
          } catch {
            // 判定失败按「这次不判定」处理：不写结论、也不刷新 checkedAt
            return null;
          }
        }),
      );

      let changed = 0;
      const next = records.map((item, index) => {
        const update = checked[index];
        if (!update) return item;
        if (update.updateAvailable && item.updateAvailable !== true) changed += 1;
        return {
          ...item,
          updateAvailable: update.updateAvailable,
          ...(update.latestVersion === undefined ? {} : { latestVersion: update.latestVersion }),
          ...(update.integrity === undefined ? {} : { integrity: update.integrity }),
          checkedAt: now,
        };
      });

      // 结论有变化才推进代次：否则每次刷新市场都会把内存会话打回一轮
      if (changed > 0) commit((current) => ({ ...current, installed: next }));
      else state.set({ ...state.get(), installed: next });
      return changed;
    },

    async create(input) {
      const marketplace = input.marketplace;
      if (marketplace && !state.get().marketplaces.some((item) => item.name === marketplace)) {
        throw new AppError(
          ERROR_CODES.marketplaceInvalid,
          `市场未登记：${marketplace}`,
          400,
          undefined,
          { reason: marketplace },
        );
      }

      const stagingRoot = storage.stagingRootFor(marketplace);
      const staged = await stageOrFail({
        source: input.source,
        stagingRoot,
        onProgress: (message) => announceProgress(message),
        ...(deps.run ? { run: deps.run } : {}),
      });
      const manifest = readManifestForInstall(staged.path);
      const name = manifest?.name ?? basename(staged.path);
      if (!PLUGIN_NAME_PATTERN.test(name)) {
        rmSync(stagingRoot, { recursive: true, force: true });
        throw new AppError(
          ERROR_CODES.pluginManifestInvalid,
          `插件名不合法：${name}`,
          400,
          undefined,
          {
            path: staged.path,
          },
        );
      }

      const id = toPluginId(name, marketplace);
      if (state.get().installed.some((item) => item.id === id)) {
        rmSync(stagingRoot, { recursive: true, force: true });
        throw new AppError(ERROR_CODES.invalidRequest, `插件已登记：${id}`, 400, undefined, { id });
      }

      const version = manifest?.version?.trim() || "0.0.0";
      const path = storage.placeStaged({ staged, marketplace, name, version, stagingRoot });
      const integrity = staged.integrity ?? directoryIntegrity(input.source);

      commit((current) => ({
        ...current,
        installed: [
          ...current.installed,
          {
            id,
            name,
            version,
            source: input.source,
            ...(marketplace ? { marketplace } : {}),
            path,
            enabled: input.enabled,
            installedAt: new Date().toISOString(),
            ...(integrity === undefined ? {} : { integrity }),
            ...(staged.etag ? { etag: staged.etag } : {}),
            ...(staged.lastModified ? { lastModified: staged.lastModified } : {}),
            updateAvailable: false,
            checkedAt: new Date().toISOString(),
          },
        ],
      }));
      // 清扫放在 commit 之后：它的前提是「还有已装插件」，首次安装时登记表刚写好
      storage.sweepOrphans("install", hasInstalled());
      return write(id);
    },

    update(input) {
      const record = state.requirePlugin(input.id);
      if (input.config) {
        const declared = registry().plugins.find((item) => item.id === record.id)?.userConfig ?? [];
        assertUserConfig(declared, input.config);
      }
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
      const purged = input.purge ? storage.purge(record) : false;
      // 清扫要在摘掉记录之前：前提是「还有已装插件」，删完就不是了
      if (purged) storage.sweepOrphans("delete", hasInstalled());
      commit((current) => ({
        ...current,
        installed: current.installed.filter((item) => item.id !== record.id),
      }));
      return { removed: true, purged, revision: state.get().revision };
    },

    async refresh(input) {
      const record = state.requirePlugin(input.id);
      const stagingRoot = storage.stagingRootFor(record.marketplace);
      const staged = await stageOrFail({
        source: record.source,
        stagingRoot,
        onProgress: (message) => announceProgress(message),
        ...(deps.run ? { run: deps.run } : {}),
      });
      const manifest = readManifestForInstall(staged.path);
      const name = manifest?.name ?? record.name;
      const version = manifest?.version?.trim() || record.version;
      const path = storage.placeStaged({
        staged,
        marketplace: record.marketplace,
        name,
        version,
        stagingRoot,
      });
      const integrity = staged.integrity ?? directoryIntegrity(record.source);

      commit((current) => ({
        ...current,
        installed: current.installed.map((item) =>
          item.id !== record.id
            ? item
            : {
                ...item,
                path,
                name,
                version,
                ...(integrity === undefined ? {} : { integrity }),
                updateAvailable: false,
                checkedAt: new Date().toISOString(),
              },
        ),
      }));
      storage.sweepOrphans("refresh", hasInstalled());
      return write(record.id);
    },
  };
};

export { PluginStateStore } from "./state";
