/**
 * /api/v1/auth：登录、登出、whoami、改密码、活动会话列表与撤销、签发一次性配对链接。
 *
 * 服务端不做本地化：失败走 AppError + ERROR_CODES，正文按契约返回。
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  type AuthLoginResponse,
  type AuthLogoutResponse,
  type AuthPasswordInput,
  type AuthPasswordResponse,
  type AuthSessionListResponse,
  type AuthSessionRevokeResponse,
  type AuthSessionView,
  authLoginInputSchema,
  authPasswordInputSchema,
  authSessionRevokeInputSchema,
  ERROR_CODES,
  emptyInputSchema,
  type PairingCreateOutput,
  type WhoamiResponse,
} from "@ucode/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import type { Services } from "../../app";
import type { AuthSessionRecord } from "../../db/auth-session-repository";
import { isSecureRequest, SESSION_COOKIE_NAME, sessionCookieOptions } from "../../lib/auth/cookies";
import type { AuthVariables, Principal } from "../../lib/auth/middleware";
import { pickLanAddress } from "../../lib/auth/net";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

/** 会话记录 → 对外视图；token 哈希不外泄 */
const toSessionView = (record: AuthSessionRecord): AuthSessionView => ({
  id: record.id,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  lastSeenAt: record.lastSeenAt,
  label: record.label,
});

/** 限流键取真实来源地址；取不到时归入同一桶（宁可更严格） */
const clientKey = (c: Context): string => {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
};

const principalOf = (c: Context<AuthVariables>): Principal => c.get("principal");

export const createAuthRoute = (services: Services) => {
  const router = new Hono<AuthVariables>();

  router.post("/login", jsonBody(authLoginInputSchema), (c) => {
    const { password, label } = c.req.valid("json");

    if (!services.auth.loginLimiter.allow(clientKey(c))) {
      throw new AppError(ERROR_CODES.rateLimited, "登录尝试过于频繁，请稍后再试", 429);
    }
    if (!services.auth.credentials.verifyPassword(password)) {
      throw new AppError(ERROR_CODES.invalidCredentials, "密码错误", 401);
    }

    const { token, record } = services.auth.sessions.create(label?.trim() || "浏览器");
    setCookie(c, SESSION_COOKIE_NAME, token, sessionCookieOptions(isSecureRequest(c)));

    return c.json(ok({ session: toSessionView(record) } satisfies AuthLoginResponse));
  });

  router.post("/logout", jsonBody(emptyInputSchema), (c) => {
    const principal = principalOf(c);
    const revoked = principal.sessionId
      ? services.auth.sessions.revoke(principal.sessionId)
      : false;
    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(isSecureRequest(c)));
    return c.json(ok({ revoked } satisfies AuthLogoutResponse));
  });

  router.get("/session", (c) => {
    const principal = principalOf(c);
    const record = principal.sessionId
      ? (services.auth.sessions.list().find((item) => item.id === principal.sessionId) ?? null)
      : null;
    return c.json(
      ok({
        kind: "owner",
        scopes: principal.scopes,
        session: record ? toSessionView(record) : null,
      } satisfies WhoamiResponse),
    );
  });

  router.get("/sessions", (c) => {
    const sessions = services.auth.sessions.list().map(toSessionView);
    return c.json(ok({ total: sessions.length, sessions } satisfies AuthSessionListResponse));
  });

  router.post("/password", jsonBody(authPasswordInputSchema), (c) => {
    const input = c.req.valid("json") satisfies AuthPasswordInput;
    if (!services.auth.credentials.verifyPassword(input.currentPassword)) {
      throw new AppError(ERROR_CODES.invalidCredentials, "当前密码错误", 401);
    }
    services.auth.credentials.setPassword(input.newPassword);
    const revokedSessions = services.auth.sessions.revokeAll();
    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(isSecureRequest(c)));
    return c.json(ok({ revokedSessions } satisfies AuthPasswordResponse));
  });

  router.post("/sessions/revoke", jsonBody(authSessionRevokeInputSchema), (c) => {
    const { authSessionId } = c.req.valid("json");
    const revoked = services.auth.sessions.revoke(authSessionId);
    return c.json(ok({ revoked } satisfies AuthSessionRevokeResponse));
  });

  router.post("/pairing/create", jsonBody(emptyInputSchema), (c) => {
    const { code, expiresAt } = services.auth.pairing.create();
    const { host, port } = services.auth.registration;
    const address = host === "0.0.0.0" ? pickLanAddress() : host;
    const scheme = isSecureRequest(c) ? "https" : "http";
    return c.json(
      ok({
        url: `${scheme}://${address}:${port}/auth/connect/${encodeURIComponent(code)}`,
        code,
        expiresAt,
      } satisfies PairingCreateOutput),
    );
  });

  return router;
};
