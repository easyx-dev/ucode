/** pino 日志实例与请求日志中间件 */
import type { MiddlewareHandler } from "hono";
import pino from "pino";

import { env } from "../../env";

/** 生产输出 JSON 供采集；开发用 pino-pretty 便于阅读 */
export const logger = pino({
  level: env.logLevel,
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }),
});

/** 记录每个请求的方法、路径、状态与耗时 */
export const requestLogger = (): MiddlewareHandler => async (c, next) => {
  const startedAt = Date.now();
  await next();
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - startedAt,
    },
    "request",
  );
};
