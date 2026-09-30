/** 服务入口：装配路由、同源托管 web 构建产物、优雅退出 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createServices } from "./app";
import { env } from "./env";
import { logger, requestLogger } from "./lib/logger";
import { AppError, fail } from "./lib/response";
import { createConfigRoute } from "./routes/config";
import { createEventsRoute } from "./routes/events";
import { createFsRoute } from "./routes/fs";
import { createHealthRoute } from "./routes/health";
import { createInteractionsRoute } from "./routes/interactions";
import { createMessagesRoute } from "./routes/messages";
import { createModelsRoute } from "./routes/models";
import { createProjectsRoute } from "./routes/projects";
import { createSessionsRoute } from "./routes/sessions";

const services = await createServices();

const app = new Hono();

app.use("*", cors({ origin: env.corsOrigin }));
app.use("*", requestLogger());

const v1 = new Hono();
v1.route("/health", createHealthRoute(services));
v1.route("/models", createModelsRoute(services));
v1.route("/config", createConfigRoute(services));
v1.route("/sessions", createSessionsRoute(services));
v1.route("/messages", createMessagesRoute(services));
v1.route("/events", createEventsRoute(services));
v1.route("/interactions", createInteractionsRoute(services));
v1.route("/projects", createProjectsRoute(services));
v1.route("/fs", createFsRoute());

app.route(API_BASE_PATH, v1);

// 生产模式：同源托管 web 构建产物。
// 注册在 API 路由之后；dist 不存在时 serveStatic 会直接放行走 notFound，
// 所以先起服务、后 `pnpm build` 也能生效（不需要重启）。
const webIndexPath = resolve(env.webDistDir, "index.html");
const webBuildExists = (): boolean => existsSync(webIndexPath);

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

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  const status = services.runtime.getStatus();
  logger.info(`http://localhost:${info.port}  (workspace: ${env.workspaceDir})`);
  if (env.legacyLayout) {
    logger.warn(
      `检测到旧布局（agent/ 或根目录的 config.json / session-state.json），不会被读取；` +
        `请手工移到 ${env.piDir} 与 ${env.appDir}`,
    );
  }
  if (status.configured) {
    logger.info(`模型: ${status.defaultModel}   thinking: ${status.thinkingLevel}`);
  } else {
    logger.warn(`模型未配置：${status.error}（POST ${API_BASE_PATH}/config/update 配置）`);
  }
  logger.info(webBuildExists() ? "已托管 apps/web/dist" : "未发现 web 构建产物（开发时用 vite）");
});

// 没有这个监听时，端口占用会以 Unhandled 'error' event 崩掉，只留一段原始堆栈
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      `端口 ${env.port} 已被占用：多半是另一个 dev 实例还在跑` +
        `（lsof -i tcp:${env.port} 查是谁），或改 .env 的 APP_PORT 与 vite 代理目标`,
    );
  } else {
    logger.error({ err: error }, "HTTP 服务启动失败");
  }
  process.exit(1);
});

const shutdown = () => {
  logger.info("关闭中…");
  services.pool.disposeAll();
  services.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
