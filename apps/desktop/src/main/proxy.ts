/**
 * 渲染层的同源代理：桌面端因此不存在跨域问题。
 *
 * 渲染层挂在应用内的自定义协议下（`app://desktop/`）：页面与接口同源，`/api/*` 由主进程转给本机服务
 * （顺带注入 `serviceToken`），其余路径从构建产物取文件。于是服务端不必为桌面端放开 `APP_CORS_ORIGIN`，
 * 凭证也不进渲染层。开发时渲染层由 Vite 提供，那条路的 `/api/*` 走 Vite 代理（见 `vite.config.ts`），
 * 令牌由主进程在发往该来源的请求上加（见 `index.ts` 的 `installDevAuthInjection`）。
 */
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import type { ServiceConnection } from "./connection.ts";

/** 渲染层在生产形态下的来源：自定义协议，页面与接口同源 */
export const RENDERER_ORIGIN = "app://desktop";

const API_PREFIX = "/api/";

/**
 * 必须在 app ready 之前注册：`standard` 让它有正常的来源语义（相对路径、同源判定），
 * `supportFetchAPI` / `stream` 是渲染层的 fetch 与 SSE 能走这条协议的前提。
 */
export const registerRendererScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
};

/** 取本机服务连接；服务可能晚于窗口就绪、或重启后换了令牌，所以每次都现读 */
export type ServiceLookup = () => ServiceConnection | null;

/** 路径归一后必须仍在构建产物目录内：协议处理器拿到的路径来自页面，不该能跳出这个目录 */
const resolveAsset = (dist: string, pathname: string): string => {
  const target = normalize(join(dist, pathname));
  if (!target.startsWith(normalize(dist))) return join(dist, "index.html");
  // 目录形态（`/`、`/assets/`）一律回落到入口，前端没有多页路由
  return pathname.endsWith("/") ? join(target, "index.html") : target;
};

export const installRendererProtocol = (dist: string, lookup: ServiceLookup): void => {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);

    if (!url.pathname.startsWith(API_PREFIX)) {
      return net.fetch(pathToFileURL(resolveAsset(dist, url.pathname)).toString());
    }

    const service = lookup();
    if (!service) return new Response("服务未运行", { status: 503 });

    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${service.token}`);
    return fetch(`${service.baseUrl}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      // 上游响应原样回传：SSE 那一类要的是流，不是攒完再发
      body: request.body,
      duplex: "half",
    });
  });
};
