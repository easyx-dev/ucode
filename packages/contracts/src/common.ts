/**
 * 跨域复用的请求与响应片段。
 *
 * 请求类型分两档：`*Request` 用 `z.input`，表示客户端发送的载荷（带默认值的字段可省）；
 * `*Input` 用 `z.infer`，表示服务端校验后的形态（默认值已填充）。
 */
import { z } from "zod";

/** 无请求参数的接口（列表、快照、刷新等）统一使用空 body */
export const emptyInputSchema = z.object({}).default({});

/** 列表类响应的公共字段；`total` 是过滤后的总数，不按 limit 截断 */
export type ListResult = {
  total: number;
};

/** 以会话为主体的动作回执，统一带上 sessionId */
export type SessionScoped = {
  sessionId: string;
};
