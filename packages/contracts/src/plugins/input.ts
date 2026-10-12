/** plugins 域的请求 zod 模型：安装、启停、卸载与重拉，`id` 用 `<name>@<marketplace>` 形状 */
import { z } from "zod";

/** 市场名同一套字符集，长度上限更短；`local` 是「直接登记本地目录」的保留名 */
const marketplaceNameSchema = z
  .string({ error: "marketplace 必须是字符串" })
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, {
    error: "marketplace 需以小写字母或数字开头，只含小写字母、数字与 . _ -",
  });

/** 插件身份：`<name>@<marketplace>`，直接登记的本地目录用 `<name>@local`；
 * 前半段的字符集与清单 `name` 一致，后半段与市场名一致 */
const pluginIdSchema = z
  .string({ error: "id 必须是字符串" })
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,63}$/, {
    error: "id 需是 <name>@<marketplace> 形状",
  });

const urlSchema = z
  .string()
  .min(1, { error: "url 不能为空" })
  .regex(/^https:\/\//, { error: "url 需以 https:// 开头" });

/**
 * 安装来源：只列已实现的五种形式。Claude 的 `command` 一类来源不在 schema 内，
 * 校验阶段就被拒，不会走到运行期再静默失败（见 `plans/plugins.md` 6.1）。
 */
export const pluginSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("directory"),
    /** 本地目录；相对路径按安装时的进程 cwd 解析，登记后不再复制 */
    path: z.string({ error: "path 必须是字符串" }).min(1, { error: "path 不能为空" }),
  }),
  z.object({
    source: z.literal("url"),
    url: urlSchema,
    /** 仅 url 来源支持：下载 `.zip` / `.tgz` 时的附加请求头 */
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    source: z.literal("npm"),
    package: z.string({ error: "package 必须是字符串" }).min(1, { error: "package 不能为空" }),
  }),
  z.object({
    source: z.literal("github"),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, { error: "repo 需是 owner/repo 形状" }),
    /** 仓内子目录；插件包不在仓根时用它 */
    path: z.string().optional(),
    ref: z.string().optional(),
  }),
  z.object({
    source: z.literal("git"),
    url: z.string().min(1, { error: "url 不能为空" }),
    path: z.string().optional(),
    ref: z.string().optional(),
  }),
]);

export const pluginListInputSchema = z.object({});

export const pluginCreateInputSchema = z.object({
  source: pluginSourceSchema,
  /** 归属市场；缺省表示直接登记本地目录（信任档位 local） */
  marketplace: marketplaceNameSchema.optional(),
  /** 项目级插件默认不启用，由状态文件或本次入参决定 */
  scope: z.enum(["user", "project"]).default("user"),
  enabled: z.boolean().default(true),
});

export const pluginUpdateInputSchema = z.object({
  id: pluginIdSchema,
  enabled: z.boolean().optional(),
  /** `userConfig` 的值；类型由清单声明，这里只承载标量 */
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** `purge` 为 true 时连磁盘上的缓存与数据目录一并删除；缺省只移除登记 */
export const pluginDeleteInputSchema = z.object({
  id: pluginIdSchema,
  purge: z.boolean().default(false),
});

export const pluginRefreshInputSchema = z.object({ id: pluginIdSchema });

export type PluginSourceInput = z.infer<typeof pluginSourceSchema>;
export type PluginListRequest = z.input<typeof pluginListInputSchema>;
export type PluginListInput = z.infer<typeof pluginListInputSchema>;
export type PluginCreateRequest = z.input<typeof pluginCreateInputSchema>;
export type PluginCreateInput = z.infer<typeof pluginCreateInputSchema>;
export type PluginUpdateRequest = z.input<typeof pluginUpdateInputSchema>;
export type PluginUpdateInput = z.infer<typeof pluginUpdateInputSchema>;
export type PluginDeleteRequest = z.input<typeof pluginDeleteInputSchema>;
export type PluginDeleteInput = z.infer<typeof pluginDeleteInputSchema>;
export type PluginRefreshRequest = z.input<typeof pluginRefreshInputSchema>;
export type PluginRefreshInput = z.infer<typeof pluginRefreshInputSchema>;
