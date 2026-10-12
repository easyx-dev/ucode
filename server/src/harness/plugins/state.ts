/**
 * 插件状态的纯逻辑：状态文件 schema、默认市场、来源分档与项目级覆盖。
 *
 * 结构与判定都在这里，文件读写留给 `services/plugins/state.ts`——
 * 依赖方向只能是 services 取用 harness，反过来会破坏分层。
 */
import { type PluginSource, pluginSourceSchema } from "@ucode/contracts";
import { z } from "zod";

/** 安装来源：与安装入参同形，状态文件按它原样落盘；市场只用到其中四种，npm 会在市场解析阶段被拒 */
export type PluginSourceSpec = z.infer<typeof pluginSourceSchema>;

/** 直接登记的本地目录在 id 里的「市场位」；它不是真的市场，不会出现在 `marketplaces` 里 */
export const LOCAL_MARKETPLACE_NAME = "local";

/** 是否属于「直接登记的本地目录」：本地位与历史遗留的空市场位都算 */
export const isLocalMarketplace = (name: string | undefined): boolean =>
  name === undefined || name === LOCAL_MARKETPLACE_NAME;

/**
 * 开箱内置的市场。`claude-plugins-official` 不是强依赖：GitHub 不可达时刷新必然失败，
 * 这种失败只落 `lastError`（见 `plans/plugins.md` 6.2）。
 *
 * 自有官方市场（`<slug>-plugins-official`）等它的 CDN 直链定下来再加——不在这里编造地址。
 */
export const DEFAULT_PLUGIN_MARKETPLACES: readonly PluginMarketplaceRecord[] = [
  {
    name: "claude-plugins-official",
    source: { source: "github", repo: "anthropics/claude-plugins-official" },
    builtin: true,
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
  lastRefreshAt: z.string().optional(),
  /** 上一次刷新是否成功；从没刷新过为 false */
  refreshedOk: z.boolean().default(false),
  lastError: z.string().optional(),
  /** 上一次成功刷新时的条目数 */
  pluginCount: z.number().int().nonnegative().default(0),
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
  scope: z.enum(["user", "project"]).default("user"),
  enabled: z.boolean().default(true),
  /** 内容摘要（url / npm 来源记下），供版本比对 */
  integrity: z.string().optional(),
  /** 安装时间（ISO 8601） */
  installedAt: z.string(),
  /** `userConfig` 的已存值 */
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** `plugins.json` 的结构；`revision` 由变更入口推进，会话按它决定是否重建 */
export const pluginStateSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  marketplaces: z.array(marketplaceRecordSchema).default([]),
  installed: z.array(installedPluginRecordSchema).default([]),
});

/** 项目级 `<cwd>/.<slug>/plugins.json` 只承载启用覆盖，默认不启用 */
export const projectPluginOverridesSchema = z.object({
  enabled: z.array(z.string().min(1)).default([]),
});

export type PluginMarketplaceRecord = z.infer<typeof marketplaceRecordSchema>;
export type InstalledPluginRecord = z.infer<typeof installedPluginRecordSchema>;
export type PluginState = z.infer<typeof pluginStateSchema>;
export type ProjectPluginOverrides = z.infer<typeof projectPluginOverridesSchema>;

/** 初始状态：两个内置市场随包写入，插件列表为空 */
export const emptyPluginState = (): PluginState => ({
  revision: 0,
  marketplaces: DEFAULT_PLUGIN_MARKETPLACES.map((record) => structuredClone(record)),
  installed: [],
});

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
 * 信任档位：随包 / 我们官方市场来的算 `official`，用户显式登记的本地目录算 `local`，
 * 其余市场一律 `market`（执行类组件只出诊断）。
 */
export const pluginSourceOf = (
  record: InstalledPluginRecord,
  marketplaces: readonly PluginMarketplaceRecord[],
): PluginSource => {
  if (isLocalMarketplace(record.marketplace)) return "local";
  const marketplace = marketplaces.find((item) => item.name === record.marketplace);
  return marketplace?.builtin ? "official" : "market";
};

/** 内置市场：刷新失败静默（只落 `lastError`），不当错误弹给用户 */
export const isBuiltinMarketplace = (
  name: string,
  marketplaces: readonly PluginMarketplaceRecord[],
): boolean => marketplaces.find((item) => item.name === name)?.builtin === true;

/**
 * 并入项目级启用覆盖：只按 id 覆盖 `enabled`，且项目级插件**默认不启用**——
 * 不在覆盖名单里的项目级插件保持关闭，用户级插件的开关不受影响。
 */
export const withProjectOverrides = (
  state: PluginState,
  overrides: ProjectPluginOverrides,
): PluginState => {
  const enabled = new Set(overrides.enabled);
  return {
    ...state,
    installed: state.installed.map((record) => {
      if (record.scope !== "project") return record;
      return { ...record, enabled: enabled.has(record.id) };
    }),
  };
};
