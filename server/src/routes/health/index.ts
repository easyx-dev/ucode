/** /api/v1/health：存活与运行时状态（全站唯一的 GET 接口，无请求参数） */
import type { HealthResponse } from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { env } from "../../env";
import { ok } from "../../lib/response";

export const createHealthRoute = (services: Services) => {
  const router = new Hono();

  router.get("/", (c) => {
    const status = services.runtime.getStatus();
    return c.json(
      ok({
        version: "v1",
        configured: status.configured,
        defaultModel: status.defaultModel,
        thinkingLevel: status.thinkingLevel,
        error: status.error,
        workspace: env.workspaceDir,
        activeSessions: services.pool.activeCount(),
        uptimeMs: Math.round(process.uptime() * 1000),
      } satisfies HealthResponse),
    );
  });

  return router;
};
