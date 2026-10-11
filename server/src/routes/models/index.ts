/** /api/v1/models：模型目录与运行时重建 */
import { emptyInputSchema, type ModelsResponse } from "@ucode/contracts";
import { Hono } from "hono";
import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

const catalogOf = (services: Services): ModelsResponse => {
  const status = services.runtime.getStatus();
  return {
    configured: status.configured,
    defaultModel: status.defaultModel,
    error: status.error,
    providers: services.runtime.getCatalog(),
  };
};

export const createModelsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(emptyInputSchema), (c) => c.json(ok(catalogOf(services))));

  /** 丢弃内存中的会话、按当前配置重建 ModelRuntime */
  router.post("/refresh", jsonBody(emptyInputSchema), async (c) => {
    await services.reload();
    return c.json(ok(catalogOf(services)));
  });

  return router;
};
