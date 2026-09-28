/** 跨路由复用的请求字段校验 */
import { z } from "zod";

/**
 * 会话 id 格式，与 pi 的 `assertValidSessionId` 一致。
 * 提前校验可以把非法 id 变成 400，而不是等到 SessionManager 抛错。
 */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);
