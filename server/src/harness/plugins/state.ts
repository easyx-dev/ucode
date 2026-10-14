/**
 * 插件状态的纯逻辑：状态文件 schema、默认市场、来源分档，以及项目级启停覆盖的读取与判定。
 *
 * 登记表的文件读写留给 `services/plugins/state.ts`——依赖方向只能是 services 取用 harness，
 * 反过来会破坏分层。覆盖文件是「读一份小 JSON + 算生效值」，放在这里是因为它没有状态：
 * 每次装配按会话 cwd 现读，改完文件新建会话即生效。
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { brand } from "@ucode/brand/values";
import {
  PLUGIN_COMPONENT_GROUPS,
  type PluginSource,
  type PluginSwitchLayer,
  pluginSourceSchema,
} from "@ucode/contracts";
import { z } from "zod";

import {
  PLUGIN_PROJECT_OVERRIDES_FILENAME,
  PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME,
  PROJECT_CONFIG_DIRNAME,
} from "../../constants/dirs";
import { describeError } from "./diagnostic";

/** 安装来源：与安装入参同形，状态文件按它原样落盘；市场只用到其中四种，npm 会在市场解析阶段被拒 */
export type PluginSourceSpec = z.infer<typeof pluginSourceSchema>;

/** 直接登记的本地目录在 id 里的「市场位」；它不是真的市场，不会出现在 `marketplaces` 里 */
export const LOCAL_MARKETPLACE_NAME = "local";

/** 是否属于「直接登记的本地目录」：本地位与历史遗留的空市场位都算 */
export const isLocalMarketplace = (name: string | undefined): boolean =>
  name === undefined || name === LOCAL_MARKETPLACE_NAME;

/**
 * 开箱内置的市场。`claude-plugins-official` 不是强依赖：GitHub 不可达时刷新必然失败，
 * 这种失败只落 `lastError`。
 *
 * 自有官方市场（`<slug>-plugins-official`）等它的 CDN 直链定下来再加——不在这里编造地址。
 */
/** 我们自己的官方市场 id：`<slug>-plugins-official`，B 端定制时随品牌走 */
export const OFFICIAL_PLUGIN_MARKETPLACE_ID = `${brand.slug}-plugins-official`;

/**
 * 开箱内置的市场。两个都不是强依赖：刷新失败只落 `lastError`，不弹用户可见错误。
 *
 * 我们自己的官方市场用 git 仓（`lvyueyang/<slug>-plugins-official`）而不是 CDN 直链：
 * 仓里放 `marketplace.json` 与插件目录即可，改完 push 就能发版，也不需要额外的 CDN 与 seed 分片。
 */
export const DEFAULT_PLUGIN_MARKETPLACES: readonly PluginMarketplaceRecord[] = [
  {
    name: OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: { source: "github", repo: `lvyueyang/${OFFICIAL_PLUGIN_MARKETPLACE_ID}` },
    builtin: true,
    trust: "official",
    refreshedOk: false,
    pluginCount: 0,
  },
  {
    name: "claude-plugins-official",
    source: { source: "github", repo: "anthropics/claude-plugins-official" },
    builtin: true,
    // 别人的官方市场：随包内置，但执行类组件按第三方档处理
    trust: "market",
    refreshedOk: false,
    pluginCount: 0,
  },
];
const marketplaceRecordSchema = z.object({
  /** 市场身份，插件 id 的后半段 */
  name: z.string().min(1),
  source: pluginSourceSchema,
  /** 随包内置：刷新失败只落 `lastError`，不出用户可见错误 */
  builtin: z.boolean().default(false),
  /**
   * 执行类组件的信任档位。与 `builtin` **无关**：随包内置只表示「开箱就有 + 失败静默」，
   * 档位看的是**市场是谁的**——只有随包资产与我们自己的官方市场算 `official`，
   * 其余（含 `claude-plugins-official` 这种别人的官方市场）都是 `market`，hooks / extensions / bin 只出诊断。
   */
  trust: z.enum(["official", "market"]).default("market"),
  lastRefreshAt: z.string().optional(),
  /** 上一次刷新是否成功；从没刷新过为 false */
  refreshedOk: z.boolean().default(false),
  lastError: z.string().optional(),
  /** 上一次成功刷新时的条目数 */
  pluginCount: z.number().int().nonnegative().default(0),
  /** url 市场的条件请求凭据；本地 / git 市场不用 */
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  /** 内容摘要：url 市场记响应哈希，git 市场记克隆副本的内容哈希 */
  integrity: z.string().optional(),
  /** 上一次刷新的条目级诊断（跳过了第几个条目之类）：列表接口原样带给界面 */
  catalogDiagnostics: z
    .array(
      z.object({
        level: z.enum(["error", "warning", "info"]),
        component: z.enum(PLUGIN_COMPONENT_GROUPS),
        message: z.string(),
      }),
    )
    .optional(),
  /** 上一次成功刷新出的条目：市场内插件列表直接读它，不再扫盘 / 打网络 */
  catalog: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().default(""),
        version: z.string().default("0.0.0"),
        /** 已解析的安装来源：相对路径在刷新时就按市场根落成绝对路径；解析不出来则缺省 */
        source: pluginSourceSchema.optional(),
      }),
    )
    .optional(),
});

const installedPluginRecordSchema = z.object({
  /** `<name>@<marketplace>`；直接登记的本地目录用 `<name>@local` */
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  source: pluginSourceSchema,
  /** 归属市场；缺省表示直接登记的本地目录（信任档位 `local`） */
  marketplace: z.string().optional(),
  /** 安装目录绝对路径：复制型来源指向 cache 副本，`directory` 源指向源目录 */
  path: z.string().min(1),
  /** 用户级登记表里的开关；某个仓库里的生效值由覆盖文件决定（`pluginSwitchOf`） */
  enabled: z.boolean().default(true),
  /** 内容摘要：本地目录来源记目录内容哈希，url / npm 记下载摘要 */
  integrity: z.string().optional(),
  /** 上次检查更新的结论：来源内容与该 integrity 不一致；缺省表示还没检查过 */
  updateAvailable: z.boolean().optional(),
  /** 远端最新版本：npm / 清单能给出时记下 */
  latestVersion: z.string().optional(),
  /** url 来源下载时的条件请求凭据，供「检查更新」发 304 探测 */
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  /** 上次检查更新的时间（ISO 8601） */
  checkedAt: z.string().optional(),
  /** 安装时间（ISO 8601） */
  installedAt: z.string(),
  /** `userConfig` 的已存值 */
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** `plugins.json` 的结构；`revision` 由变更入口推进，会话按它决定是否重建 */
export const pluginStateSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  marketplaces: z.array(marketplaceRecordSchema).default([]),
  /**
   * 用户删掉过的内置市场。只作记录：内置市场默认**每次加载都并入**（版本升级带来新市场时要能自动出现），
   * 但被删过的不再加回来——否则「可删」就是句空话。
   */
  removedMarketplaces: z.array(z.string()).default([]),
  installed: z.array(installedPluginRecordSchema).default([]),
});

/**
 * 项目级覆盖文件（`<cwd>/.<slug>/plugins.json` 与 `plugins.local.json`）：只承载启停覆盖。
 * 键是插件 id，值是「在这个仓库里开不开」；**只对已登记的 id 生效**，查不到的 id 一律忽略——
 * 项目文件永远不能把新代码带进这台机器。
 */
export const projectPluginOverridesSchema = z.object({
  enabledPlugins: z.record(z.string(), z.boolean()).default({}),
});

export type PluginMarketplaceRecord = z.infer<typeof marketplaceRecordSchema>;
export type InstalledPluginRecord = z.infer<typeof installedPluginRecordSchema>;
export type PluginState = z.infer<typeof pluginStateSchema>;

/** 初始状态：内置市场随包写入，插件列表为空 */
export const emptyPluginState = (): PluginState => ({
  revision: 0,
  marketplaces: DEFAULT_PLUGIN_MARKETPLACES.map((record) => structuredClone(record)),
  removedMarketplaces: [],
  installed: [],
});

/**
 * 并入这次版本新增的内置市场：状态文件里缺的、且用户没删过的，补回来。
 * `revision` 不动——只是多了一条市场记录，没有任何已装插件的归属或装配结果发生变化。
 */
export const withBuiltinMarketplaces = (state: PluginState): PluginState => {
  const present = new Set(state.marketplaces.map((item) => item.name));
  const removed = new Set(state.removedMarketplaces);
  const missing = DEFAULT_PLUGIN_MARKETPLACES.filter(
    (record) => !present.has(record.name) && !removed.has(record.name),
  );
  if (missing.length === 0) return state;
  return {
    ...state,
    marketplaces: [...state.marketplaces, ...missing.map((record) => structuredClone(record))],
  };
};

/** 组装插件 id：没有归属市场就是本地登记 */
export const toPluginId = (name: string, marketplace?: string): string =>
  `${name}@${marketplace ?? LOCAL_MARKETPLACE_NAME}`;

/** 拆插件 id；形状不合法返回 null（坏状态条目按它出诊断，不静默当成本地插件） */
export const parsePluginId = (id: string): { name: string; marketplace: string } | null => {
  const separator = id.lastIndexOf("@");
  if (separator <= 0 || separator === id.length - 1) return null;
  return { name: id.slice(0, separator), marketplace: id.slice(separator + 1) };
};

/**
 * 信任档位：市场声明 `trust: "official"`（随包资产与我们自己的官方市场）算 `official`，
 * 用户显式登记的本地目录算 `local`（路径可见、开发态自测用），其余市场一律 `market`。
 * 执行类组件只在前两档注入。
 */
export const pluginSourceOf = (
  record: InstalledPluginRecord,
  marketplaces: readonly PluginMarketplaceRecord[],
): PluginSource => {
  if (isLocalMarketplace(record.marketplace)) return "local";
  const marketplace = marketplaces.find((item) => item.name === record.marketplace);
  return marketplace?.trust === "official" ? "official" : "market";
};

/** 一个插件在某个工作目录里的生效开关 */
export type PluginSwitch = {
  enabled: boolean;
  /** 值由哪一层决定：`user` 是登记表本身，其余是覆盖文件 */
  enabledBy: PluginSwitchLayer;
};

export type LoadedProjectOverrides = {
  /** 合并后的值（local 覆盖 project） */
  values: Map<string, boolean>;
  /** 每个 id 的值来自哪一层 */
  layers: Map<string, PluginSwitchLayer>;
  projectPath: string;
  localPath: string;
  /** 读不出来 / 形状不对的说明；界面按它提示，不阻断任何东西 */
  diagnostics: string[];
};

const emptyOverrides = (projectPath: string, localPath: string): LoadedProjectOverrides => ({
  values: new Map(),
  layers: new Map(),
  projectPath,
  localPath,
  diagnostics: [],
});

/**
 * 读一个工作目录的两层覆盖文件。**缺文件是常态**（大多数仓库都没有），不记诊断；
 * 坏 JSON 记一条并忽略整份文件——与其它配置同一口径：坏了就跳过并报告，不拖垮会话。
 */
export const loadProjectPluginOverrides = (cwd: string): LoadedProjectOverrides => {
  const dir = resolve(cwd, PROJECT_CONFIG_DIRNAME);
  const projectPath = resolve(dir, PLUGIN_PROJECT_OVERRIDES_FILENAME);
  const localPath = resolve(dir, PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME);
  const loaded = emptyOverrides(projectPath, localPath);

  // 先 project 后 local：后写的覆盖先写的，于是 local 优先
  const files: { path: string; layer: PluginSwitchLayer }[] = [
    { path: projectPath, layer: "project" },
    { path: localPath, layer: "local" },
  ];
  for (const file of files) {
    if (!existsSync(file.path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file.path, "utf8")) as unknown;
    } catch (error) {
      loaded.diagnostics.push(`${relative(cwd, file.path)}：读不出来（${describeError(error)}）`);
      continue;
    }
    const result = projectPluginOverridesSchema.safeParse(parsed);
    if (!result.success) {
      loaded.diagnostics.push(
        `${relative(cwd, file.path)}：enabledPlugins 必须是 id 到布尔值的映射`,
      );
      continue;
    }
    for (const [id, enabled] of Object.entries(result.data.enabledPlugins)) {
      loaded.values.set(id, enabled);
      loaded.layers.set(id, file.layer);
    }
  }
  return loaded;
};

/** 算出生效开关：覆盖文件里有就按它，没有就用登记表里的值 */
export const pluginSwitchOf = (
  record: { id: string; enabled: boolean },
  overrides: LoadedProjectOverrides | null,
): PluginSwitch => {
  const layer = overrides?.layers.get(record.id);
  if (!layer) return { enabled: record.enabled, enabledBy: "user" };
  return { enabled: overrides?.values.get(record.id) === true, enabledBy: layer };
};
