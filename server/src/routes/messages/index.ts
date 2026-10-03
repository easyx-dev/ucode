/** /api/v1/messages：会话历史读取，以及发起生成（投递）、编辑重发与中断 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  type MessageInterruptResponse,
  type MessageListResponse,
  messageEditInputSchema,
  messageListInputSchema,
  type PromptAdmittedResponse,
  promptInputSchema,
  sessionIdInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { resolveSessionCwd } from "../../agent/session-config";
import type { Services } from "../../app";
import { projectMessages } from "../../core/projection";
import { admitEdit, admitPrompt } from "../../core/run";
import { transcriptStates } from "../../core/serialize";
import { env } from "../../env";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(messageListInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const record = services.sessions.find(sessionId);
    const live = services.pool.get(sessionId);
    // 会话在池中时以它的内存条目为准：草稿（首轮回复完成前）还没写 JSONL，
    // 只读文件会让刷新后的对话区空着，直到首条 assistant 消息落盘。
    const manager =
      live?.sessionManager ??
      (record?.sourcePath
        ? SessionManager.open(record.sourcePath, env.sessionsRoot, resolveSessionCwd(record))
        : null);
    const entries = manager ? manager.buildContextEntries() : [];
    // 会话级设置沿完整路径推进：压缩只裁剪展示条目，看裁剪后的列表会让压缩点之后丢档位
    const states = transcriptStates(manager ? manager.getBranch() : []);

    // 序号与投影必须在同一同步块内取：中间一旦插入事件，
    // 客户端按 seq 切分实时帧时就会重复渲染或漏掉一段增量。
    const seq = services.events.latestSeq(sessionId);
    const projection = projectMessages(sessionId, live, entries, states);

    return c.json(
      ok({
        sessionId,
        // 会话不存在（例如刚被归档）时没有可报的目录，交给客户端按空串处理
        cwd: record ? resolveSessionCwd(record) : "",
        persisted: Boolean(record?.sourcePath),
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

  // 编辑一条用户消息并重发：同样只做受理，生成在后台推进；旧分支保留在会话文件里
  router.post("/edit", jsonBody(messageEditInputSchema), async (c) => {
    const input = c.req.valid("json");
    await admitEdit(services, input);
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
