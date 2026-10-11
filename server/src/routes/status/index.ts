/** /api/v1/status：认证后的运行时状态（原 health 富载荷；未认证不可访问） */
import type { StatusResponse } from "@ucode/contracts";
import { Hono } from "hono";
import { env } from "../../env";
import { ok } from "../../platform/response";
import type { Services } from "../../services";

export const createStatusRoute = (services: Services) => {
  const router = new Hono();

  router.get("/", (c) => {
    const status = services.runtime.getStatus();
    return c.json(
      ok({
        configured: status.configured,
        defaultModel: status.defaultModel,
        error: status.error,
        workspace: env.workspacesDir,
        activeSessions: services.pool.activeCount(),
        uptimeMs: Math.round(process.uptime() * 1000),
      } satisfies StatusResponse),
    );
  });

  return router;
};
