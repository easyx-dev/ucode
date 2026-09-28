import "./env";

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createServices } from "./app";
import { env } from "./env";
import { AppError, fail } from "./lib/result";
import { createConfigRoute } from "./routes/config";
import { createHealthRoute } from "./routes/health";
import { createMessagesRoute } from "./routes/messages";
import { createModelsRoute } from "./routes/models";
import { createSessionsRoute } from "./routes/sessions";

const services = await createServices();

const app = new Hono();

app.use("*", cors({ origin: env.corsOrigin }));
app.use("*", logger());

const v1 = new Hono();
v1.route("/health", createHealthRoute(services));
v1.route("/models", createModelsRoute(services));
v1.route("/config", createConfigRoute(services));
v1.route("/sessions", createSessionsRoute(services));
v1.route("/messages", createMessagesRoute(services));

app.route("/api/v1", v1);

// 生产模式：同源托管 web 构建产物。
// 注册在 API 路由之后；dist 不存在时 serveStatic 会直接放行走 notFound，
// 所以先起服务、后 `pnpm build` 也能生效（不需要重启）。
const webIndexPath = resolve(env.webDistDir, "index.html");
const webBuildExists = (): boolean => existsSync(webIndexPath);

app.use("*", serveStatic({ root: relative(process.cwd(), env.webDistDir) || "." }));

app.notFound((c) => {
  const path = c.req.path;
  if (path.startsWith("/api/")) {
    return c.json(fail("not_found", `接口不存在：${path}`), 404);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json(fail("not_found", `路由不存在：${path}`), 404);
  }
  if (!webBuildExists()) {
    return c.text("web 未构建：请运行 pnpm build（开发时请访问 vite 端口）", 404);
  }
  return c.html(readFileSync(webIndexPath, "utf8"));
});

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json(
      fail(error.code, error.message, error.details),
      error.status as ContentfulStatusCode,
    );
  }
  console.error("[ucode] 未处理异常:", error);
  return c.json(fail("internal_error", error instanceof Error ? error.message : String(error)), 500);
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  const status = services.runtime.getStatus();
  console.log(`[ucode] http://localhost:${info.port}  (workspace: ${env.workspaceDir})`);
  console.log(
    status.configured
      ? `[ucode] 模型: ${status.defaultModel}   thinking: ${status.thinkingLevel}`
      : `[ucode] 模型未配置：${status.error}（POST /api/v1/config/update 配置）`,
  );
  console.log(
    webBuildExists() ? "[ucode] 已托管 apps/web/dist" : "[ucode] 未发现 web 构建产物（开发时用 vite）",
  );
});

const shutdown = () => {
  console.log("\n[ucode] 关闭中…");
  services.pool.disposeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
