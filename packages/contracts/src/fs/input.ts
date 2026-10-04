/** fs 域的请求 zod 模型：目录浏览与新建目录 */
import { z } from "zod";

import { FS_LIST_FILTERS } from "../constants";

/**
 * 目录浏览。`path` 省略时从用户 home 开始；`type` 过滤条目，
 * 目录选择器传 `directory`，文件预览器用默认的 `all`；
 * `q` 按名称模糊过滤条目（配合目录选择器把「不存在的路径末段」当检索词）。
 */
export const fsListInputSchema = z.object({
  path: z.string().min(1).optional(),
  q: z.string().optional(),
  type: z.enum(FS_LIST_FILTERS).default("all"),
});

export const fsMkdirInputSchema = z.object({
  /** 待创建目录的绝对路径 */
  path: z.string().min(1),
});

/**
 * 文件检索（给 `@` 用的受限 walker）。`path` 缺省取会话工作目录；`q` 按名称模糊过滤；
 * `limit` 是返回条数上限，超出的部分由响应里的 `truncated` 标注。
 */
export const fsSearchInputSchema = z.object({
  path: z.string().min(1).optional(),
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export type FsListInput = z.infer<typeof fsListInputSchema>;
export type FsListRequest = z.input<typeof fsListInputSchema>;
export type FsMkdirInput = z.infer<typeof fsMkdirInputSchema>;
export type FsMkdirRequest = z.input<typeof fsMkdirInputSchema>;
export type FsSearchInput = z.infer<typeof fsSearchInputSchema>;
export type FsSearchRequest = z.input<typeof fsSearchInputSchema>;
