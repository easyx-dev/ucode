/** marketplace 域的请求 zod 模型：市场来源的登记、移除、刷新与列举 */
import { z } from "zod";

/** 市场名：与插件名同一套字符集，长度上限更短 */
const marketplaceNameSchema = z
  .string({ error: "name 必须是字符串" })
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, {
    error: "name 需以小写字母或数字开头，只含小写字母、数字与 . _ -",
  });

const urlSchema = z
  .string()
  .min(1, { error: "url 不能为空" })
  .regex(/^https:\/\//, { error: "url 需以 https:// 开头" });

/** 市场来源：`npm` 不是市场的合法来源（市场本身是清单文件，不是包） */
export const marketplaceSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("directory"),
    /** 指向含 `marketplace.json` 的目录；条目里的相对路径相对它解析 */
    path: z.string({ error: "path 必须是字符串" }).min(1, { error: "path 不能为空" }),
  }),
  z.object({
    source: z.literal("url"),
    /** `marketplace.json` 直链；这种市场里没有本地仓库，条目必须用显式来源 */
    url: urlSchema,
  }),
  z.object({
    source: z.literal("github"),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, { error: "repo 需是 owner/repo 形状" }),
    ref: z.string().optional(),
  }),
  z.object({
    source: z.literal("git"),
    url: z.string().min(1, { error: "url 不能为空" }),
    ref: z.string().optional(),
  }),
]);

export const marketplaceListInputSchema = z.object({});

export const marketplaceCreateInputSchema = z.object({
  name: marketplaceNameSchema,
  source: marketplaceSourceSchema,
});

export const marketplaceDeleteInputSchema = z.object({ name: marketplaceNameSchema });

export const marketplaceRefreshInputSchema = z.object({ name: marketplaceNameSchema });

/** 市场内插件列表：读上一次刷新出的条目（不触发网络） */
export const marketplaceInfoInputSchema = z.object({ name: marketplaceNameSchema });

export type MarketplaceSourceInput = z.infer<typeof marketplaceSourceSchema>;
export type MarketplaceListRequest = z.input<typeof marketplaceListInputSchema>;
export type MarketplaceListInput = z.infer<typeof marketplaceListInputSchema>;
export type MarketplaceCreateRequest = z.input<typeof marketplaceCreateInputSchema>;
export type MarketplaceCreateInput = z.infer<typeof marketplaceCreateInputSchema>;
export type MarketplaceDeleteRequest = z.input<typeof marketplaceDeleteInputSchema>;
export type MarketplaceDeleteInput = z.infer<typeof marketplaceDeleteInputSchema>;
export type MarketplaceRefreshRequest = z.input<typeof marketplaceRefreshInputSchema>;
export type MarketplaceRefreshInput = z.infer<typeof marketplaceRefreshInputSchema>;
export type MarketplaceInfoRequest = z.input<typeof marketplaceInfoInputSchema>;
export type MarketplaceInfoInput = z.infer<typeof marketplaceInfoInputSchema>;
