/** /api/v1/info：服务发现与版本兼容（未认证可访问，供客户端决定「用现有服务 / 自己拉起」） */
import { API_VERSION, type ServerInfoResponse } from "@ucode/contracts";
import { Hono } from "hono";

import { ok } from "../../lib/response";
import { compatRange, serviceVersion } from "../../lib/version";

export const createInfoRoute = () => {
  const router = new Hono();

  router.get("/", (c) =>
    c.json(
      ok({
        version: serviceVersion,
        apiVersion: API_VERSION,
        compatRange,
      } satisfies ServerInfoResponse),
    ),
  );

  return router;
};
