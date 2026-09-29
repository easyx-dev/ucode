/** /api/v1/messages：会话历史的读取，以及发起生成（SSE 流式）与中断 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  type MessageInterruptResponse,
  type MessageListResponse,
  messageListInputSchema,
  promptInputSchema,
  sessionIdInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { streamSessionRun } from "../../core/run-stream";
import { entriesToDTO } from "../../core/serialize";
import { env } from "../../env";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(messageListInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const info = await services.pool.findInfo(sessionId);

    if (!info) {
      return c.json(
        ok({
          sessionId,
          messages: [],
          persisted: false,
          cwd: env.workspaceDir,
        } satisfies MessageListResponse),
      );
    }

    const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
    const entries = manager.buildContextEntries();

    return c.json(
      ok({
        sessionId,
        cwd: info.cwd,
        persisted: true,
        messages: entriesToDTO(entries),
      } satisfies MessageListResponse),
    );
  });

  router.post("/prompt", jsonBody(promptInputSchema), (c) =>
    streamSessionRun(c, services, c.req.valid("json")),
  );

  router.post("/interrupt", jsonBody(sessionIdInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const aborted = await services.pool.abort(sessionId);
    return c.json(ok({ sessionId, aborted } satisfies MessageInterruptResponse));
  });

  return router;
};
