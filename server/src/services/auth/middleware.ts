/**
 * 鉴权中间件：放行清单 + 把 `Authorization: Bearer` 解析为 principal。
 *
 * 不做 IP 信任：loopback 不自动放行（DNS rebinding 下任意网页都能请求 127.0.0.1）。
 * 单一凭证管线：头里可能是原生客户端的 `serviceToken`（免交互），也可能是浏览器登录 / 配对换来的会话 token；
 * 前者先做常量时间比对，后者查 `auth_session` 得到可撤销的会话行。凭证不放 Cookie——Cookie 不区分端口，
 * 同 host 上并存的两个实例会互相顶掉会话。
 * 解析出的 principal 带 `scopes`（当前恒为 `["*"]`），为以后的角色 / 权限分级留口子。
 */
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import type { Context, MiddlewareHandler } from "hono";

import { fail } from "../../platform/response";
import type { CredentialStore } from "./credentials";
import type { SessionService } from "./sessions";

export type Principal = {
  kind: "owner";
  /** 权限分级暂缓，当前恒为 ["*"]（见 plans/service-and-auth.md §3.8） */
  scopes: string[];
  /** 会话主体对应的会话 id；serviceToken 为 null */
  sessionId: string | null;
};

export type AuthVariables = { Variables: { principal: Principal } };

const ALLOWED_GET = new Set([`${API_BASE_PATH}/health`, `${API_BASE_PATH}/info`]);
// 配对码本身就是凭证，兑换接口与登录同级放行
const ALLOWED_POST = new Set([
  `${API_BASE_PATH}/auth/login`,
  `${API_BASE_PATH}/auth/pairing/redeem`,
]);

/** 放行清单：健康 / 发现 / 登录 / 配对兑换；OPTIONS 预检交给 CORS 中间件，这里直接放行 */
const isAllowed = (method: string, path: string): boolean => {
  if (method === "OPTIONS") return true;
  if (method === "GET") return ALLOWED_GET.has(path);
  if (method === "POST") return ALLOWED_POST.has(path);
  return false;
};

const resolvePrincipal = (
  c: Context<AuthVariables>,
  deps: { credentials: CredentialStore; sessions: SessionService },
): Principal | null => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  if (deps.credentials.verifyToken(token)) {
    return { kind: "owner", scopes: ["*"], sessionId: null };
  }

  const session = deps.sessions.authenticate(token);
  return session ? { kind: "owner", scopes: ["*"], sessionId: session.id } : null;
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

    return c.json(fail(ERROR_CODES.unauthorized, "未认证：请先登录"), 401);
  };
};
