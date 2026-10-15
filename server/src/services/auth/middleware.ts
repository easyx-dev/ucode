/**
 * 鉴权中间件：放行清单 + 把 `Authorization: Bearer` 解析为 principal。
 *
 * 不做 IP 信任：loopback 不自动放行（DNS rebinding 下任意网页都能请求 127.0.0.1）。
 * 单一凭证管线：头里可能是原生客户端的 `serviceToken`（免交互），也可能是浏览器登录 / 配对换来的会话 token；
 * 前者先做常量时间比对，后者查 `auth_session` 得到可撤销的会话行。凭证不放 Cookie——Cookie 不区分端口，
 * 同 host 上并存的两个实例会互相顶掉会话。
 * 解析出的 principal 带 `scopes`（当前恒为 `["*"]`），为以后的角色 / 权限分级留口子。
 *
 * 唯一的例外是终端输出流的握手（见 `TERMINAL_STREAM_PATH`）：它拿的不是长期凭证而是一次性票。
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

/**
 * 终端输出流的 WebSocket 握手。它不走 `Authorization`（浏览器的 WS API 带不了自定义头、
 * 凭证也不走 Cookie），改用一次性握手票；票在这里**预检**（不消耗），核销留给路由。
 * 预检而不是放行整条路径：无效票（或没票）压根不该让它建起连接。
 */
const TERMINAL_STREAM_PATH = `${API_BASE_PATH}/terminal/stream`;
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
  /** 握手票预检：返回票是否有效且绑在这个终端上（见 `TERMINAL_STREAM_PATH`） */
  peekTicket: (ticket: string, terminalId: string) => boolean;
}): MiddlewareHandler<AuthVariables> => {
  return async (c, next) => {
    if (isAllowed(c.req.method, c.req.path)) {
      await next();
      return;
    }

    if (c.req.method === "GET" && c.req.path === TERMINAL_STREAM_PATH) {
      const ticket = c.req.query("ticket");
      const terminalId = c.req.query("terminalId");
      if (ticket && terminalId && deps.peekTicket(ticket, terminalId)) {
        await next();
        return;
      }
      return c.json(fail(ERROR_CODES.unauthorized, "未认证：终端握手票无效"), 401);
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
