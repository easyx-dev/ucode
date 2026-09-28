/** /api/v1/messages：会话历史的读取，以及发送（SSE 流式）与中断 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Hono } from "hono";
import { z } from "zod";

import type { Services } from "../app";
import { env } from "../env";
import { ok } from "../lib/result";
import { sessionIdSchema } from "../lib/schemas";
import { jsonBody } from "../lib/validate";
import { streamSessionRun } from "../pi/run-stream";
import { entriesToDTO } from "../pi/serialize";

const sessionIdBodySchema = z.object({ sessionId: sessionIdSchema });

const sendSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().min(1),
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
  cwd: z.string().min(1).optional(),
});

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(sessionIdBodySchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const info = await services.pool.findInfo(sessionId);

    if (!info) {
      return c.json(ok({ sessionId, messages: [], persisted: false, cwd: env.workspaceDir }));
    }

    const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
    const entries = manager.buildContextEntries();

    return c.json(
      ok({ sessionId, cwd: info.cwd, persisted: true, messages: entriesToDTO(entries) }),
    );
  });

  router.post("/send", jsonBody(sendSchema), (c) =>
    streamSessionRun(c, services, c.req.valid("json")),
  );

  router.post("/interrupt", jsonBody(sessionIdBodySchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const aborted = await services.pool.abort(sessionId);
    return c.json(ok({ sessionId, aborted }));
  });

  return router;
};
