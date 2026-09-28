import { Hono } from "hono";
import { z } from "zod";

import type { Services } from "../app";
import { ok } from "../lib/result";
import { jsonBody } from "../lib/validate";

const emptyBody = z.object({}).default({});

export const createModelsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(emptyBody), (c) => {
    const status = services.runtime.getStatus();
    return c.json(
      ok({
        configured: status.configured,
        defaultModel: status.defaultModel,
        thinkingLevel: status.thinkingLevel,
        error: status.error,
        providers: services.runtime.getCatalog(),
      }),
    );
  });

  /** 丢弃内存中的会话、按当前配置重建 ModelRuntime */
  router.post("/refresh", jsonBody(emptyBody), async (c) => {
    await services.reload();
    const status = services.runtime.getStatus();
    return c.json(
      ok({
        configured: status.configured,
        defaultModel: status.defaultModel,
        thinkingLevel: status.thinkingLevel,
        error: status.error,
        providers: services.runtime.getCatalog(),
      }),
    );
  });

  return router;
};
