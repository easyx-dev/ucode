/** 把一次会话运行（含生成中的 steer / follow-up 投递）以 SSE 事件流写回响应 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";

import type { Services } from "../app";
import { AppError } from "../lib/result";
import { type SseEvent, toSseEvents } from "./events";

export type SessionRunInput = {
  sessionId: string;
  text: string;
  /** 生成中再发消息时的投递方式 */
  behavior: "follow-up" | "steer";
  /** 仅新建会话时生效的工作目录 */
  cwd?: string;
};

type SendEvent = (event: string, data: unknown) => Promise<void>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** SSE 写出器：客户端断开后静默丢弃后续事件，不再抛错 */
export const createSseWriter = (stream: SSEStreamingApi): SendEvent => {
  let closed = false;
  stream.onAbort(() => {
    closed = true;
  });

  return async (event, data) => {
    if (closed) return;
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data ?? {}) });
    } catch {
      closed = true;
    }
  };
};

/** 事件泵：顺序写出订阅到的事件，避免多次 write 并发交错 */
export const createEventPump = (send: SendEvent) => {
  const queue: SseEvent[] = [];
  const waiters: Array<() => void> = [];
  let finished = false;

  const notify = () => {
    while (waiters.length > 0) waiters.shift()?.();
  };

  const running = (async () => {
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

  return {
    push: (events: SseEvent[]) => {
      if (events.length === 0) return;
      queue.push(...events);
      notify();
    },
    finish: () => {
      finished = true;
      notify();
    },
    running,
  };
};

/** 等占位的 run 真正进入 streaming（prompt 内部还有鉴权等异步步骤） */
const waitForBusy = async (
  session: AgentSession,
  isRunning: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.isStreaming) return true;
    if (!isRunning()) return false;
    await sleep(25);
  }
  return session.isStreaming;
};

/** 决定这一轮是开新 run，还是把消息投递给正在跑的 run */
const dispatchPrompt = async (options: {
  services: Services;
  session: AgentSession;
  sessionId: string;
  text: string;
  behavior: SessionRunInput["behavior"];
  send: SendEvent;
}): Promise<void> => {
  const { services, session, sessionId, text, behavior, send } = options;

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

  if (!services.pool.isRunning(sessionId) && !session.isStreaming) {
    await startRun();
    return;
  }

  if (await waitForBusy(session, () => services.pool.isRunning(sessionId))) {
    if (behavior === "steer") await session.steer(text);
    else await session.followUp(text);
    await send("queued", { sessionId, behavior });
    await session.waitForIdle();
    return;
  }

  // 占位者已经结束（可能失败）：退化成新的一轮
  await startRun();
};

/** 会话运行的完整 SSE 处理；ensure 失败（未配置模型等）在开流前抛错，返回 JSON */
export const streamSessionRun = async (
  c: Context,
  services: Services,
  input: SessionRunInput,
): Promise<Response> => {
  const { sessionId, text, behavior, cwd } = input;

  // 只在「创建/取回 AgentSession」这段加锁。run 本身不占锁，
  // 否则并发请求会一直排队到上一轮结束，steer / follow-up 永远不会生效。
  const session = await services.pool.withLock(sessionId, () =>
    services.pool.ensure(sessionId, cwd),
  );

  return streamSSE(c, async (stream) => {
    const send = createSseWriter(stream);
    try {
      const pump = createEventPump(send);
      const unsubscribe = session.subscribe((event) => pump.push(toSseEvents(event)));

      try {
        await dispatchPrompt({ services, session, sessionId, text, behavior, send });
      } finally {
        unsubscribe();
        pump.finish();
      }

      await pump.running;
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
};
