/** /api/v1/messages：会话历史读取，以及发起生成（投递）与中断 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  type MessageInterruptResponse,
  type MessageListResponse,
  messageListInputSchema,
  type PromptAdmittedResponse,
  promptInputSchema,
  sessionIdInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { projectMessages } from "../../core/projection";
import { admitPrompt } from "../../core/run";
import { env } from "../../env";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(messageListInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const info = await services.pool.findInfo(sessionId);
    const manager = info ? SessionManager.open(info.path, env.sessionsRoot, info.cwd) : null;
    const entries = manager ? manager.buildContextEntries() : [];

    // 序号与投影必须在同一同步块内取：中间一旦插入事件，
    // 客户端按 seq 切分实时帧时就会重复渲染或漏掉一段增量。
    // 会话尚未落盘（首轮回复完成前）时 entries 为空，投影仍能给出在途消息。
    const seq = services.events.latestSeq(sessionId);
    const projection = projectMessages(sessionId, services.pool.get(sessionId), entries);

    return c.json(
      ok({
        sessionId,
        cwd: info?.cwd ?? env.workspaceDir,
        persisted: info !== undefined,
        running: services.pool.isActive(sessionId),
        seq,
        ...projection,
      } satisfies MessageListResponse),
    );
  });

  // 只做受理：真正的生成在服务端后台推进，结果统一走 /events
  router.post("/prompt", jsonBody(promptInputSchema), async (c) => {
    const input = c.req.valid("json");
    await admitPrompt(services, input);
    return c.json(
      ok({ sessionId: input.sessionId, admitted: true } satisfies PromptAdmittedResponse),
    );
  });

  router.post("/interrupt", jsonBody(sessionIdInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const aborted = await services.pool.abort(sessionId);
    return c.json(ok({ sessionId, aborted } satisfies MessageInterruptResponse));
  });

  return router;
};
