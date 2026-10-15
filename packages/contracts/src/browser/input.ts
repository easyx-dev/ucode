/** browser 域的请求 zod 模型：浏览器 profile 的列举与删除 */
import { z } from "zod";

/** 列举 profile 不需要参数（数据目录由服务端按 `$APP_HOME` 定位） */
export const browserListInputSchema = z.object({});

/**
 * 删除 profile：传名字即删这几份，传空数组即清空全部（动作表里没有 `clear`，
 * 「清空」由调用方先列举再传全集表达）。
 */
export const browserDeleteInputSchema = z.object({
  names: z.array(z.string().min(1)).max(64),
});

export type BrowserListInput = z.infer<typeof browserListInputSchema>;
export type BrowserDeleteInput = z.infer<typeof browserDeleteInputSchema>;
export type BrowserDeleteRequest = z.input<typeof browserDeleteInputSchema>;
