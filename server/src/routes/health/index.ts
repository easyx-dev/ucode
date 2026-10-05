/** /api/v1/health：存活探针（最小载荷，未认证可访问，不泄露模型 / 配置） */
import type { HealthMinimalResponse } from "@ucode/contracts";
import { Hono } from "hono";

import { ok } from "../../lib/response";
import { serviceVersion } from "../../lib/version";

export const createHealthRoute = () => {
  const router = new Hono();

  router.get("/", (c) =>
    c.json(ok({ up: true, version: serviceVersion } satisfies HealthMinimalResponse)),
  );

  return router;
};
