/** HTTP 应用装配：全局中间件、鉴权、各域路由挂载、静态托管与错误封套 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HUB_BASE_PATH_HEADER } from "./constants/hub";

import { env } from "./env";
import { logger, requestLogger } from "./platform/logger";
import { AppError, fail } from "./platform/response";
import { createAgentsRoute } from "./routes/agents";
import { createAssetsRoute } from "./routes/assets";
import { createAttachmentsRoute } from "./routes/attachments";
import { createAuthRoute } from "./routes/auth";
import { createBrowserRoute } from "./routes/browser";
import { createCommandsRoute } from "./routes/commands";
import { createConfigRoute } from "./routes/config";
import { createEventsRoute } from "./routes/events";
import { createFsRoute } from "./routes/fs";
import { createGitRoute } from "./routes/git";
import { createGoalsRoute } from "./routes/goals";
import { createHealthRoute } from "./routes/health";
import { createHubRoute } from "./routes/hub";
import { createInfoRoute } from "./routes/info";
import { createInteractionsRoute } from "./routes/interactions";
import { createMarketplaceRoute } from "./routes/marketplace";
import { createMcpRoute } from "./routes/mcp";
import { createMessagesRoute } from "./routes/messages";
import { createModelsRoute } from "./routes/models";
import { createPluginsRoute } from "./routes/plugins";
import { createProjectsRoute } from "./routes/projects";
import { createServiceRoute } from "./routes/service";
import { createSessionsRoute } from "./routes/sessions";
import { createStatsRoute } from "./routes/stats";
import { createStatusRoute } from "./routes/status";
import { createTerminalRoute } from "./routes/terminal";
import type { Services } from "./services";
import { type AuthVariables, createAuthMiddleware } from "./services/auth/middleware";

/** web 构建产物的入口；dist 不存在时静态托管直接放行，所以先起服务、后 `pnpm build` 也能生效 */
const webIndexPath = resolve(env.webDistDir, "index.html");
export const webBuildExists = (): boolean => existsSync(webIndexPath);

/** 入口文件里可被改写的那行基准路径，以及没有它时的插入点 */
const INDEX_BASE_TAG = /<base\s+href="[^"]*"\s*\/?>/i;
const INDEX_HEAD_TAG = /<head[^>]*>/i;

/** 挂载前缀的形态：站内绝对路径，不带协议、主机与查询串（它要写进 HTML 属性） */
const INDEX_BASE_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/;

/** 取中继注入的挂载前缀；缺省或形态不对都按「挂在根上」处理 */
const readIndexBasePath = (raw: string | undefined): string | null => {
  const value = (raw ?? "").replace(/\/+$/, "");
  return INDEX_BASE_PATH_PATTERN.test(value) && value !== "" ? value : null;
};

/** 把基准路径落到 `<base href>` 上：有这行就改写，没有就插到 `<head>` 之后（构建产物与早期产物都适用） */
const withIndexBasePath = (html: string, basePath: string): string => {
  const tag = `<base href="${basePath}/" />`;
  if (INDEX_BASE_TAG.test(html)) return html.replace(INDEX_BASE_TAG, tag);
  return html.replace(INDEX_HEAD_TAG, (head) => `${head}\n    ${tag}`);
};

/**
 * 返回 web 入口文件。页面被挂在路径前缀下时（中继的 `/d/<设备 id>`）把 `<base href>` 指过去：
 * 构建产物里的资源是相对路径，浏览器靠这一行才能把它们解析到前缀下。
 */
const renderWebIndex = (c: Context<AuthVariables>): Response => {
  const html = readFileSync(webIndexPath, "utf8");
  const basePath = readIndexBasePath(c.req.header(HUB_BASE_PATH_HEADER));
  return c.html(basePath ? withIndexBasePath(html, basePath) : html);
};

export const createApp = (
  services: Services,
): { app: Hono<AuthVariables>; injectWebSocket: NodeWebSocket["injectWebSocket"] } => {
  const app = new Hono<AuthVariables>();
  // WebSocket 适配器要在注册路由前拿到 app：升级请求交给同一套路由处理（鉴权中间件照跑），
  // 而它返回的 `injectWebSocket` 要等 `serve()` 拿到 http server 之后再挂上去（见 main.ts）
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  // CORS 只对白名单来源开放；凭证走 `Authorization` 头而非 Cookie，故带凭证的跨域请求也不需要 Cookie 语义
  // 预检必须放行 `authorization`，否则桌面端渲染层（独立端口）连不上本机服务
  const allowedOrigins = env.corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use("*", cors({ origin: allowedOrigins, allowHeaders: ["content-type", "authorization"] }));
  app.use("*", requestLogger());
  app.use(
    `${API_BASE_PATH}/*`,
    createAuthMiddleware({
      credentials: services.auth.credentials,
      sessions: services.auth.sessions,
      upgradeTickets: {
        [`${API_BASE_PATH}/browser/desktop`]: {
          message: "未认证：浏览器通道握手票无效",
          peek: (query) => {
            const ticket = query("ticket");
            return Boolean(ticket && services.browsers.desktop.peekTicket(ticket));
          },
        },
        [`${API_BASE_PATH}/terminal/stream`]: {
          message: "未认证：终端握手票无效",
          peek: (query) => {
            const ticket = query("ticket");
            const terminalId = query("terminalId");
            return Boolean(
              ticket && terminalId && services.terminals.peekTicket(ticket, terminalId),
            );
          },
        },
      },
    }),
  );

  const v1 = new Hono<AuthVariables>();
  v1.route("/health", createHealthRoute());
  v1.route("/info", createInfoRoute());
  v1.route("/status", createStatusRoute(services));
  v1.route("/auth", createAuthRoute(services));
  v1.route("/service", createServiceRoute(services));
  v1.route("/hub", createHubRoute(services));
  v1.route("/models", createModelsRoute(services));
  v1.route("/config", createConfigRoute(services));
  v1.route("/sessions", createSessionsRoute(services));
  v1.route("/projects", createProjectsRoute(services));
  v1.route("/goals", createGoalsRoute(services));
  v1.route("/stats", createStatsRoute(services));
  v1.route("/messages", createMessagesRoute(services));
  v1.route("/events", createEventsRoute(services));
  v1.route("/interactions", createInteractionsRoute(services));
  v1.route("/fs", createFsRoute());
  v1.route("/git", createGitRoute());
  v1.route("/mcp", createMcpRoute(services));
  v1.route("/plugins", createPluginsRoute(services));
  v1.route("/marketplace", createMarketplaceRoute(services));
  v1.route("/commands", createCommandsRoute(services));
  v1.route("/attachments", createAttachmentsRoute(services));
  v1.route("/agents", createAgentsRoute(services));
  v1.route("/assets", createAssetsRoute(services));
  v1.route("/browser", createBrowserRoute(services, upgradeWebSocket));
  v1.route("/terminal", createTerminalRoute(services, upgradeWebSocket));

  app.route(API_BASE_PATH, v1);

  // 注册在 API 路由之后：dev server / 桌面端走各自的端口，这里只管生产同源托管
  // 根路径先自己接：`serveStatic` 会直接把 index.html 原样发出去，跳过按挂载前缀的改写
  app.get("/", renderWebIndex);
  app.use("*", serveStatic({ root: relative(process.cwd(), env.webDistDir) || "." }));

  app.notFound((c) => {
    const path = c.req.path;
    if (path.startsWith("/api/")) {
      return c.json(fail(ERROR_CODES.notFound, `接口不存在：${path}`), 404);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.json(fail(ERROR_CODES.notFound, `路由不存在：${path}`), 404);
    }
    if (!webBuildExists()) {
      return c.text("web 未构建：请运行 pnpm build（开发时请访问 vite 端口）", 404);
    }
    return renderWebIndex(c);
  });

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        fail(error.code, error.message, error.details, error.params),
        error.status as ContentfulStatusCode,
      );
    }
    logger.error({ err: error }, "未处理异常");
    return c.json(
      fail(ERROR_CODES.internal, error instanceof Error ? error.message : String(error)),
      500,
    );
  });

  return { app, injectWebSocket };
};
