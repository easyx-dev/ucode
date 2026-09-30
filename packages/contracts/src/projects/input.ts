/** 项目空间的请求 zod 模型：登记、改名、删除 */
import { z } from "zod";

export const projectCreateInputSchema = z.object({
  /** 已存在目录的路径；服务端归一化后登记 */
  path: z.string().min(1),
});

export const projectUpdateInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
});

export const projectDeleteInputSchema = z.object({
  projectId: z.string().min(1),
});

export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;
export type ProjectCreateRequest = z.input<typeof projectCreateInputSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;
export type ProjectUpdateRequest = z.input<typeof projectUpdateInputSchema>;
export type ProjectDeleteInput = z.infer<typeof projectDeleteInputSchema>;
export type ProjectDeleteRequest = z.input<typeof projectDeleteInputSchema>;
