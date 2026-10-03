/** /api/v1/stats：使用统计（从会话记录聚合，不落库） */
import { type StatsSummaryResponse, statsSummaryInputSchema } from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createStatsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/summary", jsonBody(statsSummaryInputSchema), (c) => {
    const { days } = c.req.valid("json");
    const summary: StatsSummaryResponse = services.usage.summary(days);
    return c.json(ok(summary));
  });

  return router;
};
