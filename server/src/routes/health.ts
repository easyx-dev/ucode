/** /api/v1/health：存活与运行时状态 */
import { Hono } from "hono";

import type { Services } from "../app";
import { env } from "../env";
import { ok } from "../lib/result";

export const createHealthRoute = (services: Services) => {
  const router = new Hono();

  router.get("/", (c) => {
    const status = services.runtime.getStatus();
    return c.json(
      ok({
        version: "v1",
        configured: status.configured,
        model: status.defaultModel,
        thinkingLevel: status.thinkingLevel,
        error: status.error,
        workspace: env.workspaceDir,
        activeSessions: services.pool.activeCount(),
        uptimeMs: Math.round(process.uptime() * 1000),
      }),
    );
  });

  return router;
};
