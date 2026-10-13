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

/**
 * 重排项目：`paths` 是侧栏里从上到下的项目目录，服务端按数组次序记下来。
 * 只给界面上看得见的那些，没提到的行接在后面——客户端拿不到不可见的行，不该擅自给它们排位。
 */
export const projectReorderInputSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});

export type ProjectReorderRequest = z.input<typeof projectReorderInputSchema>;
export type ProjectReorderInput = z.infer<typeof projectReorderInputSchema>;
