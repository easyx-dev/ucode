/** 服务入口：创建服务与应用、监听端口、优雅退出 */
import { serve } from "@hono/node-server";

import { createApp, webBuildExists } from "./app";
import { env } from "./env";
import { instanceId } from "./platform/instance";
import { logger } from "./platform/logger";
import { ensureSpawnHelperExecutable } from "./platform/node-pty";
import {
  ensureServiceRegistration,
  writeServicePid,
  writeServiceRegistration,
} from "./platform/service-registration";
import { createServices } from "./services";

// 工作台终端靠 node-pty：安装时没跑 postinstall（如 pnpm 全局安装）的话，这里补一次执行位
for (const helper of ensureSpawnHelperExecutable()) {
  logger.info(`node-pty：spawn-helper 已设为可执行（${helper}）`);
}

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
const { app, injectWebSocket } = createApp(services);

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
  // 本进程的身份在这里才定：ensure 阶段写它会在绑定失败时改掉在跑实例的标识（见 service-registration）
  registration.instanceId = instanceId;
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
    logger.info(`模型: ${status.defaultModel}`);
  } else {
    logger.warn(`模型未配置：${status.error}（POST /api/v1/config/update 配置）`);
  }
  logger.info(webBuildExists() ? "已托管 web 构建产物" : "未发现 web 构建产物（开发时用 vite）");
});

// 没有这个监听时，端口占用会以 Unhandled 'error' event 崩掉，只留一段原始堆栈
// WebSocket 的升级监听先挂上：它与 http server 共用同一个端口（终端输出流走 WS，见 routes/terminal）
injectWebSocket(server);

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
