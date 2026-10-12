/** /api/v1/marketplace：插件市场来源的登记、移除与刷新 */
import {
  type MarketplaceDeleteResponse,
  type MarketplacesListResponse,
  type MarketplaceWriteResponse,
  marketplaceCreateInputSchema,
  marketplaceDeleteInputSchema,
  marketplaceListInputSchema,
  marketplaceRefreshInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

export const createMarketplaceRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(marketplaceListInputSchema), (c) => {
    const response: MarketplacesListResponse = services.marketplaces.list();
    return c.json(ok(response));
  });

  router.post("/create", jsonBody(marketplaceCreateInputSchema), (c) => {
    const response: MarketplaceWriteResponse = services.marketplaces.create(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/delete", jsonBody(marketplaceDeleteInputSchema), (c) => {
    const response: MarketplaceDeleteResponse = services.marketplaces.delete(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/refresh", jsonBody(marketplaceRefreshInputSchema), async (c) => {
    const response: MarketplaceWriteResponse = await services.marketplaces.refresh(
      c.req.valid("json"),
    );
    return c.json(ok(response));
  });

  return router;
};
