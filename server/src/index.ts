/** 服务入口：装配路由、同源托管 web 构建产物、优雅退出 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createServices } from "./app";
import { env } from "./env";
import { isSecureRequest, SESSION_COOKIE_NAME, sessionCookieOptions } from "./lib/auth/cookies";
import { type AuthVariables, createAuthMiddleware } from "./lib/auth/middleware";
import { logger, requestLogger } from "./lib/logger";
import { AppError, fail } from "./lib/response";
import {
  ensureServiceRegistration,
  writeServicePid,
  writeServiceRegistration,
} from "./lib/service-file";
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
import { createMcpRoute } from "./routes/mcp";
import { createMessagesRoute } from "./routes/messages";
import { createModelsRoute } from "./routes/models";
import { createServiceRoute } from "./routes/service";
import { createSessionsRoute } from "./routes/sessions";
import { createStatsRoute } from "./routes/stats";
import { createStatusRoute } from "./routes/status";

// 服务注册：复用已有凭证，首次启动生成 serviceToken 与登录密码（权限 0600）
// 必须在 createServices 之前，鉴权对象要绑定同一份凭证
const { registration, created } = ensureServiceRegistration({
  path: env.servicePath,
  host: env.host,
  port: env.port,
});
if (created) {
  logger.warn(`已生成服务注册文件 ${env.servicePath}（权限 0600）`);
  logger.warn(`首次启动登录密码：${registration.password}（忘记时可直接查看该文件）`);
}

const services = await createServices(registration);

const app = new Hono<AuthVariables>();

// CORS 只对白名单来源开放并允许携带 Cookie；同源与原生客户端不经 CORS
// 不能再用 `origin: "*"`——带凭证时通配来源本身就不合法，也会放行任意网页
const allowedOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use("*", cors({ origin: allowedOrigins, credentials: true }));
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
v1.route("/goals", createGoalsRoute(services));
v1.route("/stats", createStatsRoute(services));
v1.route("/messages", createMessagesRoute(services));
v1.route("/events", createEventsRoute(services));
v1.route("/interactions", createInteractionsRoute(services));
v1.route("/fs", createFsRoute());
v1.route("/git", createGitRoute());
v1.route("/mcp", createMcpRoute(services));
v1.route("/commands", createCommandsRoute(services));
v1.route("/attachments", createAttachmentsRoute(services));
v1.route("/agents", createAgentsRoute(services));

app.route(API_BASE_PATH, v1);

// 一次性配对链接：API 前缀之外，兑换成功后种会话 Cookie 并跳进应用
app.get("/auth/connect/:code", (c) => {
  const result = services.auth.pairing.redeem(c.req.param("code"));
  if (result !== "ok") {
    const error = result === "expired" ? ERROR_CODES.pairingExpired : ERROR_CODES.pairingInvalid;
    return c.redirect(`/login?error=${error}`, 302);
  }
  const { token } = services.auth.sessions.create("配对设备");
  setCookie(c, SESSION_COOKIE_NAME, token, sessionCookieOptions(isSecureRequest(c)));
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect("/", 302);
});

// 生产模式：同源托管 web 构建产物
// 注册在 API 路由之后；dist 不存在时 serveStatic 会直接放行走 notFound，
// 所以先起服务、后 `pnpm build` 也能生效（不需要重启）
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

/** 实际监听端口要等 listen 回调才确定（端口 0 时自选），供 CLI `--open` 等待后再打开 */
let resolveListening: (port: number) => void = () => {};
export const listening = new Promise<number>((resolvePort) => {
  resolveListening = resolvePort;
});

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  // listen 成功后才落盘 host / port / pid：绑定失败（如端口占用）时保持既有注册不变，
  // 否则会把正在运行实例的 pid 覆盖成即将退出的本进程
  registration.port = info.port;
  registration.pid = process.pid;
  writeServiceRegistration(env.servicePath, registration);
  resolveListening(info.port);
  const status = services.runtime.getStatus();
  logger.info(`http://${env.host}:${info.port}  (home: ${env.homeDir})`);
  if (env.host !== "127.0.0.1" && env.host !== "::1") {
    logger.warn(
      `已监听 ${env.host}：同网段可访问，而 agent 具备 bash / 读写权限，请勿暴露到不可信网络`,
    );
  }
  if (status.configured) {
    logger.info(`模型: ${status.defaultModel}   thinking: ${status.thinkingLevel}`);
  } else {
    logger.warn(`模型未配置：${status.error}（POST ${API_BASE_PATH}/config/update 配置）`);
  }
  logger.info(webBuildExists() ? "已托管 web 构建产物" : "未发现 web 构建产物（开发时用 vite）");
});

// 没有这个监听时，端口占用会以 Unhandled 'error' event 崩掉，只留一段原始堆栈
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      `端口 ${env.port} 已被占用：多半是另一个实例还在跑` +
        `（lsof -i tcp:${env.port} 查是谁），或改 APP_PORT / ${env.servicePath}`,
    );
  } else {
    logger.error({ err: error }, "HTTP 服务启动失败");
  }
  process.exit(1);
});

const shutdown = () => {
  logger.info("关闭中…");
  writeServicePid(env.servicePath, null);
  services.pool.disposeAll();
  services.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
