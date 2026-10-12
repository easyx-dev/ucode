/**
 * 插件注册表：把登记表与各插件的清单装载结果合成一份可用的插件集。
 *
 * **发现只认登记表**，不扫插件根目录——否则「把目录拷进去」就等价于授予可信来源
 * （见 `plans/plugins.md` 4.4）。每次按状态现算，不做模块级缓存；进程内的缓存对象由装配层
 * 持有并随 revision 失效。
 */

import { readFileSync } from "node:fs";
import {
  PLUGIN_EXECUTABLE_GROUPS,
  type PluginComponentGroup,
  type PluginDiagnosticView,
} from "@ucode/contracts";

import { loadPluginAgents } from "./agent-file";
import { isDirectory } from "./components";
import { describeError, diagnostic } from "./diagnostic";
import { loadPluginHooks, type PluginHookBinding } from "./hooks";
import { loadPluginManifest } from "./manifest";
import {
  type InstalledPluginRecord,
  isLocalMarketplace,
  type PluginMarketplaceRecord,
  pluginSourceOf,
} from "./state";
import type { PluginComponentEntry, PluginDescriptor, PluginRegistry } from "./types";

/** 实际存在、且因来源为第三方市场而不注入运行时的执行类组件分组 */
const blockedGroups = (
  components: readonly PluginComponentEntry[],
  source: PluginDescriptor["source"],
): PluginComponentGroup[] => {
  if (source !== "market") return [];
  const present = new Set(components.map((entry) => entry.group));
  return PLUGIN_EXECUTABLE_GROUPS.filter((group) => present.has(group));
};

/**
 * hooks 的来源：清单写成对象 / 数组时是内联定义，写成字符串（或默认布局）时是文件。
 * 文件读不出来只记诊断——一个坏 hook 不该让整包不可用。
 */
const readHooksSource = (input: {
  pluginId: string;
  pluginRoot: string;
  file: string | null;
  inline: unknown;
}): { value: unknown; source: string; diagnostics: PluginDiagnosticView[] } => {
  if (input.inline !== undefined && typeof input.inline !== "string") {
    return { value: input.inline, source: "清单 hooks", diagnostics: [] };
  }
  if (!input.file) return { value: undefined, source: "hooks", diagnostics: [] };
  try {
    return {
      value: JSON.parse(readFileSync(input.file, "utf8")) as unknown,
      source: "hooks/hooks.json",
      diagnostics: [],
    };
  } catch (error) {
    return {
      value: undefined,
      source: "hooks/hooks.json",
      diagnostics: [
        diagnostic("error", "hooks", `hooks/hooks.json：读不出来（${describeError(error)}）`),
      ],
    };
  }
};

const describePlugin = (
  record: InstalledPluginRecord,
  marketplaces: readonly PluginMarketplaceRecord[],
  takenAgentSlugs: Set<string>,
): PluginDescriptor => {
  const source = pluginSourceOf(record, marketplaces);
  const base = {
    id: record.id,
    version: record.version,
    updateAvailable: record.updateAvailable === true,
    ...(record.latestVersion ? { latestVersion: record.latestVersion } : {}),
    ...(record.checkedAt ? { checkedAt: record.checkedAt } : {}),
    source,
    enabled: record.enabled,
    root: record.path,
    installedAt: record.installedAt,
  };

  if (!isDirectory(record.path)) {
    return {
      ...base,
      name: record.name,
      displayName: record.name,
      description: "",
      components: [],
      assets: { skills: [], prompts: [], extensions: [] },
      userConfig: [],
      config: {},
      agents: [],
      hooks: [],
      blocked: [],
      diagnostics: [diagnostic("error", "manifest", `安装目录不存在：${record.path}`)],
    };
  }

  const load = loadPluginManifest(record.path);
  const hooksFile = load.components.find((entry) => entry.group === "hooks")?.path ?? null;
  const hooksSource = readHooksSource({
    pluginId: record.id,
    pluginRoot: record.path,
    file: hooksFile,
    inline: load.manifest?.hooks,
  });
  const hooksLoad: { bindings: PluginHookBinding[]; diagnostics: PluginDiagnosticView[] } =
    hooksSource.value === undefined
      ? { bindings: [], diagnostics: [] }
      : loadPluginHooks({
          pluginId: record.id,
          pluginRoot: record.path,
          source: hooksSource.source,
          value: hooksSource.value,
        });
  const agentLoad = loadPluginAgents({
    pluginName: load.name,
    files: load.components
      .filter((entry) => entry.group === "agents" && entry.path)
      .map((entry) => entry.path as string),
    taken: takenAgentSlugs,
  });
  return {
    ...base,
    // 名称与版本以清单为准：升级换目录后不必回写登记表的快照
    name: load.name,
    displayName: load.displayName,
    description: load.description,
    version: load.version,
    components: load.components,
    assets: load.assets,
    userConfig: load.userConfig,
    config: record.config ?? {},
    agents: agentLoad.agents,
    hooks: hooksLoad.bindings,
    blocked: blockedGroups(load.components, source),
    diagnostics: [
      ...load.diagnostics,
      ...agentLoad.diagnostics,
      ...hooksSource.diagnostics,
      ...hooksLoad.diagnostics,
    ],
  };
};

/** 构建注册表；登记表里的重复 id 只保留第一条，其余出诊断 */
export const buildPluginRegistry = (state: {
  revision: number;
  marketplaces: PluginMarketplaceRecord[];
  installed: InstalledPluginRecord[];
}): PluginRegistry => {
  const diagnostics: PluginDiagnosticView[] = [];
  const seen = new Set<string>();
  // 角色 slug 的占用集合跨插件共享：同名插件 token 撞车时靠它加哈希后缀
  const takenAgentSlugs = new Set<string>();
  const plugins: PluginDescriptor[] = [];

  for (const record of state.installed) {
    if (seen.has(record.id)) {
      diagnostics.push(
        diagnostic("error", "manifest", `登记表里有重复的插件 id：${record.id}，只保留第一条`),
      );
      continue;
    }
    seen.add(record.id);
    if (
      !isLocalMarketplace(record.marketplace) &&
      !state.marketplaces.some((item) => item.name === record.marketplace)
    ) {
      // 来源未知一律按第三方市场处理：门控方向只能更严，不能因为市场记录丢了就放宽
      diagnostics.push(
        diagnostic(
          "warning",
          "manifest",
          `插件 ${record.id} 归属的市场 ${record.marketplace} 已不在登记表里，按第三方市场处理`,
        ),
      );
    }
    plugins.push(describePlugin(record, state.marketplaces, takenAgentSlugs));
  }

  return { revision: state.revision, plugins, diagnostics };
};
