/** 请求侧判定：直连 TLS 或经可信反代（`x-forwarded-proto`）时视为安全请求（配对链接取 scheme 用） */
import type { Context } from "hono";

export const isSecureRequest = (c: Context): boolean =>
  c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
