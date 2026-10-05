/** 会话 Cookie 的命名与选项：名由品牌 slug 派生，httpOnly + SameSite=Strict + Path=/ */
import { brand } from "@ucode/brand/values";
import type { Context } from "hono";
import type { CookieOptions } from "hono/utils/cookie";

import { AUTH_SESSION_TTL_MS } from "../../constants";

export const SESSION_COOKIE_NAME = `${brand.slug}_session`;

/** `secure` 由请求协议决定：有 TLS 才加，局域网明文 http 下加会导致 Cookie 根本不下发 */
export const sessionCookieOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: "Strict",
  path: "/",
  maxAge: Math.floor(AUTH_SESSION_TTL_MS / 1000),
  secure,
});

/** 直连 TLS 或经可信反代（`x-forwarded-proto`）时视为安全请求 */
export const isSecureRequest = (c: Context): boolean =>
  c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
