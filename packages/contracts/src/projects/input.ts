/** project 接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

/**
 * 修改项目：按 `path` 寻址（项目的自然键就是路径），行还不存在时补建。
 * 目前只有「改名」一个可改项，`name` 必给、`null` 表示清空。
 *
 * 模型 / 档位 / 模式不走这个接口：它们由用户在会话里选择后自动写回（见 `sessions/update`），
 * 单一写入口径才不会出现「项目设置」与「会话选择」互相覆盖的情形。
 */
export const projectUpdateInputSchema = z.object({
  path: z.string().min(1),
  /** 新的展示名；`null` 表示清空（客户端回落目录末段） */
  name: z.string().min(1).nullable(),
});

export type ProjectUpdateRequest = z.input<typeof projectUpdateInputSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;
