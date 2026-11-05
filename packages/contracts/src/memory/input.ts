/** memory 接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { MEMORY_BODY_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from "../constants";

/**
 * 一条记忆的定位：**记忆目录名 + 事实文件名**，两者都只允许单段名字
 * （目录名由服务端从 `memory/projects` 下列出来，文件名来自索引行；带上分隔符一律拒掉）。
 */
const factRefFields = {
  dir: z.string().min(1).max(128),
  file: z.string().min(1).max(128),
};

/** 读一条记忆的正文 */
export const memoryReadInputSchema = z.object(factRefFields);

/**
 * 改一条记忆：标题与正文整体替换（patch 语义在这里没有意义——一条记忆就是这几行），
 * 文件名不变，索引行跟着改。只能改**已有**条目，新建不在这个接口里。
 */
export const memoryUpdateInputSchema = z.object({
  ...factRefFields,
  title: z.string().trim().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  content: z.string().trim().min(1).max(MEMORY_BODY_MAX_LENGTH),
});

/** 删一条记忆：文件与索引行一起删 */
export const memoryDeleteInputSchema = z.object(factRefFields);

export type MemoryReadRequest = z.input<typeof memoryReadInputSchema>;
export type MemoryReadInput = z.infer<typeof memoryReadInputSchema>;
export type MemoryUpdateRequest = z.input<typeof memoryUpdateInputSchema>;
export type MemoryUpdateInput = z.infer<typeof memoryUpdateInputSchema>;
export type MemoryDeleteRequest = z.input<typeof memoryDeleteInputSchema>;
export type MemoryDeleteInput = z.infer<typeof memoryDeleteInputSchema>;
