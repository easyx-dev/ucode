/**
 * 鉴权中间件：放行清单 + 把 `Authorization: Bearer` 解析为 principal。
 *
 * 不做 IP 信任：loopback 不自动放行（DNS rebinding 下任意网页都能请求 127.0.0.1）。
 * 单一凭证管线：头里可能是原生客户端的 `serviceToken`（免交互），也可能是浏览器登录 / 配对换来的会话 token；
 * 前者先做常量时间比对，后者查 `auth_session` 得到可撤销的会话行。凭证不放 Cookie——Cookie 不区分端口，
 * 同 host 上并存的两个实例会互相顶掉会话。
 * 解析出的 principal 带 `scopes`（当前恒为 `["*"]`），为以后的角色 / 权限分级留口子。
 *
 * 例外是 WebSocket 升级端点的握手（终端输出流、浏览器帧流）：它们拿的不是长期凭证而是一次性票，
 * 走 `upgradeTickets` 那张表按路径分派（见 `createAuthMiddleware`）。
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
 * 升级端点的握手票：它不走 `Authorization`（浏览器的 WS API 带不了自定义头、凭证也不走 Cookie），
 * 改用客户端先用带鉴权请求换来的一次性票；票在这里**预检**（不消耗），核销留给路由。
 * 预检而不是放行整条路径：无效票（或没票）压根不该让它建起连接。
 */
export type UpgradeTicketGate = {
  /** 取 query 参数做预检；返回票是否有效（不消耗票） */
  peek: (query: (name: string) => string | undefined) => boolean;
  /** 拒绝时的中文兜底（客户端按 code 渲染，看不到这句） */
  message: string;
};
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
  /** 需要一次性握手票的升级路径（完整路径 → 准入判定）；缺省即没有这类端点 */
  upgradeTickets?: Record<string, UpgradeTicketGate>;
}): MiddlewareHandler<AuthVariables> => {
  return async (c, next) => {
    if (isAllowed(c.req.method, c.req.path)) {
      await next();
      return;
    }

    const gate = c.req.method === "GET" ? deps.upgradeTickets?.[c.req.path] : undefined;
    if (gate) {
      if (gate.peek((name) => c.req.query(name))) {
        await next();
        return;
      }
      return c.json(fail(ERROR_CODES.unauthorized, gate.message), 401);
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
