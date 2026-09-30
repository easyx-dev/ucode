/** /api/v1/interactions：交互请求（当前是权限审批）的回答与补齐 */
import {
  type InteractionListInput,
  type InteractionListResponse,
  type InteractionRespondInput,
  type InteractionRespondResponse,
  interactionListInputSchema,
  interactionRespondInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createInteractionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/respond", jsonBody(interactionRespondInputSchema), (c) => {
    const input = c.req.valid("json") as InteractionRespondInput;
    return c.json(ok(services.interactions.respond(input) satisfies InteractionRespondResponse));
  });

  router.post("/list", jsonBody(interactionListInputSchema), (c) => {
    const { sessionId } = c.req.valid("json") as InteractionListInput;
    return c.json(
      ok({ interactions: services.interactions.list(sessionId) } satisfies InteractionListResponse),
    );
  });

  return router;
};
