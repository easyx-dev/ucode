/** HTTP 应用装配：全局中间件、鉴权、各域路由挂载、静态托管与错误封套 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { env } from "./env";
import { logger, requestLogger } from "./platform/logger";
import { AppError, fail } from "./platform/response";
import { createAgentsRoute } from "./routes/agents";
import { createAttachmentsRoute } from "./routes/attachments";
import { createAuthRoute } from "./routes/auth";
import { createCommandsRoute } from "./routes/commands";
import { createConfigRoute } from "./routes/config";
import { createEventsRoute } from "./routes/events";
import { createFsRoute } from "./routes/fs";
import { createGitRoute } from "./routes/git";
import { createGoalsRoute } from "./routes/goals";
import { createHealthRoute } from "./routes/health";
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
import type { Services } from "./services";
import { type AuthVariables, createAuthMiddleware } from "./services/auth/middleware";

/** web 构建产物的入口；dist 不存在时静态托管直接放行，所以先起服务、后 `pnpm build` 也能生效 */
const webIndexPath = resolve(env.webDistDir, "index.html");
export const webBuildExists = (): boolean => existsSync(webIndexPath);

export const createApp = (services: Services): Hono<AuthVariables> => {
  const app = new Hono<AuthVariables>();

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
    }),
  );

  const v1 = new Hono<AuthVariables>();
  v1.route("/health", createHealthRoute());
  v1.route("/info", createInfoRoute());
  v1.route("/status", createStatusRoute(services));
  v1.route("/auth", createAuthRoute(services));
  v1.route("/service", createServiceRoute(services));
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

  app.route(API_BASE_PATH, v1);

  // 注册在 API 路由之后：dev server / 桌面端走各自的端口，这里只管生产同源托管
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
    return c.html(readFileSync(webIndexPath, "utf8"));
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

  return app;
};
