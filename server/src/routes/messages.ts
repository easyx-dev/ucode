import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { Services } from "../app";
import { env } from "../env";
import { AppError, ok } from "../lib/result";
import { sessionIdSchema } from "../lib/schemas";
import { jsonBody } from "../lib/validate";
import { toSseEvents, type SseEvent } from "../pi/events";
import { entriesToDTO } from "../pi/serialize";

const sessionIdBodySchema = z.object({ sessionId: sessionIdSchema });

const sendSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().min(1),
  /** 生成中再发消息时的投递方式：steer 在当前工具调用后插入，follow-up 等本轮结束 */
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
  cwd: z.string().min(1).optional(),
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  /** 会话历史 */
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

  /** 发送消息，以 SSE 流返回生成过程 */
  router.post("/send", jsonBody(sendSchema), async (c) => {
    const { sessionId, text, behavior, cwd } = c.req.valid("json");

    // 只在「创建/取回 AgentSession」这段加锁。run 本身不占锁，
    // 否则并发请求会一直排队到上一轮结束，steer / follow-up 永远不会生效。
    const session = await services.pool.withLock(sessionId, () =>
      services.pool.ensure(sessionId, cwd),
    );

    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });

      const send = async (event: string, data: unknown) => {
        if (closed) return;
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data ?? {}) });
        } catch {
          closed = true;
        }
      };

      try {
        const queue: SseEvent[] = [];
        const waiters: Array<() => void> = [];
        let finished = false;

        const notify = () => {
          while (waiters.length > 0) waiters.shift()?.();
        };

        const unsubscribe = session.subscribe((event) => {
          const mapped = toSseEvents(event);
          if (mapped.length > 0) queue.push(...mapped);
          notify();
        });

        const pump = (async () => {
          while (!finished || queue.length > 0) {
            const next = queue.shift();
            if (next) {
              await send(next.event, next.data);
              continue;
            }
            if (finished) break;
            await new Promise<void>((resolve) => {
              waiters.push(resolve);
            });
          }
        })();

        /** 抢占这一轮；抢不到说明别的请求正在跑 */
        const startRun = async () => {
          if (!services.pool.beginRun(sessionId)) {
            throw new AppError("session_busy", "会话正忙，请稍后重试或改用 steer", 409);
          }
          try {
            await session.prompt(text);
          } finally {
            services.pool.endRun(sessionId);
          }
        };

        /** 等占位的 run 真正进入 streaming（prompt 里还有鉴权等异步步骤） */
        const waitForBusy = async (timeoutMs = 3000): Promise<boolean> => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (session.isStreaming) return true;
            if (!services.pool.isRunning(sessionId)) return false;
            await sleep(25);
          }
          return session.isStreaming;
        };

        try {
          if (!services.pool.isRunning(sessionId) && !session.isStreaming) {
            await startRun();
          } else if (await waitForBusy()) {
            if (behavior === "steer") {
              await session.steer(text);
            } else {
              await session.followUp(text);
            }
            await send("queued", { sessionId, behavior });
            await session.waitForIdle();
          } else {
            // 占位者已经结束（可能失败）：退化成新的一轮
            await startRun();
          }
        } finally {
          finished = true;
          unsubscribe();
          notify();
        }

        await pump;
        await send("done", { sessionId });
      } catch (error) {
        await send("error", {
          sessionId,
          code: error instanceof AppError ? error.code : "internal_error",
          message: error instanceof Error ? error.message : String(error),
        });
        await send("done", { sessionId, error: true });
      }
    });
  });

  /** 中断当前生成 */
  router.post("/interrupt", jsonBody(sessionIdBodySchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const aborted = await services.pool.abort(sessionId);
    return c.json(ok({ sessionId, aborted }));
  });

  return router;
};
