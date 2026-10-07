/** fs 域的请求 zod 模型：目录浏览、新建目录、按名检索与读取文件 */
import { z } from "zod";

import { FS_LIST_FILTERS, FS_READ_MAX_BYTES } from "../constants";

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
 * 文件检索（给 `@` 用的受限 walker）。`path` 省略时从用户 home 开始（调用方传会话工作目录以限定范围）；
 * `q` 按名称模糊过滤；`limit` 是返回条数上限，超出的部分由响应里的 `truncated` 标注。
 */
export const fsSearchInputSchema = z.object({
  path: z.string().min(1).optional(),
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

/**
 * 读取单个文件的内容（预览器用）。只能读普通文件，目录报 `not_a_file`；
 * `maxBytes` 是调用方愿意接收的内联体积，超出时文本按上限截断、二进制整块不返回。
 */
export const fsReadInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(FS_READ_MAX_BYTES).optional(),
});

export type FsListInput = z.infer<typeof fsListInputSchema>;
export type FsListRequest = z.input<typeof fsListInputSchema>;
export type FsMkdirInput = z.infer<typeof fsMkdirInputSchema>;
export type FsMkdirRequest = z.input<typeof fsMkdirInputSchema>;
export type FsSearchInput = z.infer<typeof fsSearchInputSchema>;
export type FsSearchRequest = z.input<typeof fsSearchInputSchema>;
export type FsReadInput = z.infer<typeof fsReadInputSchema>;
export type FsReadRequest = z.input<typeof fsReadInputSchema>;
