/** /api/v1/plugins：插件登记表的读写（安装 / 启停 / 卸载 / 重拉），落 `$APP_HOME/app/plugins.json` */
import {
  type PluginDeleteResponse,
  type PluginsListResponse,
  type PluginWriteResponse,
  pluginCreateInputSchema,
  pluginDeleteInputSchema,
  pluginListInputSchema,
  pluginRefreshInputSchema,
  pluginUpdateInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

export const createPluginsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(pluginListInputSchema), (c) => {
    const response: PluginsListResponse = services.plugins.list(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/create", jsonBody(pluginCreateInputSchema), async (c) => {
    const response: PluginWriteResponse = await services.plugins.create(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/update", jsonBody(pluginUpdateInputSchema), (c) => {
    const response: PluginWriteResponse = services.plugins.update(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/delete", jsonBody(pluginDeleteInputSchema), (c) => {
    const response: PluginDeleteResponse = services.plugins.delete(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/refresh", jsonBody(pluginRefreshInputSchema), async (c) => {
    const response: PluginWriteResponse = await services.plugins.refresh(c.req.valid("json"));
    return c.json(ok(response));
  });

  return router;
};
