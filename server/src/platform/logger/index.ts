/** pino 日志实例与请求日志中间件 */
import type { MiddlewareHandler } from "hono";
import pino from "pino";

import { HUB_CLIENT_HEADER, HUB_DEVICE_HEADER, HUB_SOURCE_HEADER } from "../../constants/hub";
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

/** 记录每个请求的方法、路径、状态与耗时；经中继（hub）进来的请求附上来源标记 */
export const requestLogger = (): MiddlewareHandler => async (c, next) => {
  const startedAt = Date.now();
  await next();
  // 来源头由中继客户端注入，只作统计与排查，不参与鉴权（见 docs/api.md「传输约定」）
  const hubSource = c.req.header(HUB_SOURCE_HEADER);
  const hubDevice = c.req.header(HUB_DEVICE_HEADER);
  const hubClient = c.req.header(HUB_CLIENT_HEADER);
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - startedAt,
      ...(hubSource ? { hubSource } : {}),
      ...(hubDevice ? { hubDevice } : {}),
      ...(hubClient ? { hubClient } : {}),
    },
    "request",
  );
};
