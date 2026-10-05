/**
 * 鉴权中间件：放行清单 + 把 Cookie / Bearer 统一解析为 principal。
 *
 * 不做 IP 信任：loopback 不自动放行（DNS rebinding 下任意网页都能请求 127.0.0.1）。
 * 本机原生客户端用 `serviceToken` 免交互，浏览器走配对链接或登录；两者最终都收敛为「有 session 或 bearer」。
 * 解析出的 principal 带 `scopes`（当前恒为 `["*"]`），为以后的角色 / 权限分级留口子。
 */
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { fail } from "../response";
import { SESSION_COOKIE_NAME } from "./cookies";
import type { CredentialStore } from "./credentials";
import type { SessionService } from "./sessions";

export type Principal = {
  kind: "owner";
  /** 权限分级暂缓，当前恒为 ["*"]（见 plans/service-and-auth.md §3.8） */
  scopes: string[];
  /** Cookie 会话主体的会话 id；Bearer 为 null */
  sessionId: string | null;
};

export type AuthVariables = { Variables: { principal: Principal } };

const ALLOWED_GET = new Set([`${API_BASE_PATH}/health`, `${API_BASE_PATH}/info`]);
const ALLOWED_POST = new Set([`${API_BASE_PATH}/auth/login`]);

/** 放行清单：健康 / 发现 / 登录；OPTIONS 预检交给 CORS 中间件，这里直接放行 */
const isAllowed = (method: string, path: string): boolean => {
  if (method === "OPTIONS") return true;
  if (method === "GET") return ALLOWED_GET.has(path);
  if (method === "POST") return ALLOWED_POST.has(path);
  return false;
};

/** 浏览器导航类请求（Accept 带 text/html）未认证时跳登录页，其余返回 401 封套 */
const isNavigation = (accept: string | undefined): boolean =>
  typeof accept === "string" && accept.includes("text/html");

const resolvePrincipal = (
  c: Context<AuthVariables>,
  deps: { credentials: CredentialStore; sessions: SessionService },
): Principal | null => {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token && deps.credentials.verifyToken(token)) {
      return { kind: "owner", scopes: ["*"], sessionId: null };
    }
  }

  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  if (cookie) {
    const session = deps.sessions.authenticate(cookie);
    if (session) return { kind: "owner", scopes: ["*"], sessionId: session.id };
  }

  return null;
};

export const createAuthMiddleware = (deps: {
  credentials: CredentialStore;
  sessions: SessionService;
}): MiddlewareHandler<AuthVariables> => {
  return async (c, next) => {
    if (isAllowed(c.req.method, c.req.path)) {
      await next();
      return;
    }

    const principal = resolvePrincipal(c, deps);
    if (principal) {
      c.set("principal", principal);
      await next();
      return;
    }

    if (isNavigation(c.req.header("accept"))) {
      return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`, 302);
    }
    return c.json(fail(ERROR_CODES.unauthorized, "未认证：请先登录"), 401);
  };
};
