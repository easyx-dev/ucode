/** /api/v1/events：全局事件流（SSE），承载所有会话的实时事件 */
import { emptyInputSchema, type ServerEvent } from "@ucode/contracts";
import { Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { EVENTS_HEARTBEAT_MS, SUBSCRIBER_QUEUE_MAX } from "../../constants/session";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

/** 统一的帧格式：SSE 事件名固定 message，真正的类型在 JSON 里 */
const writeFrame = async (stream: SSEStreamingApi, frame: ServerEvent): Promise<void> => {
  await stream.writeSSE({ event: "message", data: JSON.stringify(frame) });
};

/**
 * 事件泵：只允许一个写出者，避免多次 write 并发交错。
 * 订阅者自带待发队列，队列满了直接断流——慢客户端靠重连后的快照补齐，
 * 而不是让服务端无限缓冲。
 */
const pumpEvents = async (stream: SSEStreamingApi, services: Services): Promise<void> => {
  const queue: ServerEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let overflow = false;

  const notify = (): void => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };

  /** 等到有事件、连接关闭，或心跳超时 */
  const waitForWork = (): Promise<"work" | "idle"> =>
    new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const onWake = (): void => {
        if (timer) clearTimeout(timer);
        if (wake === onWake) wake = null;
        resolve("work");
      };
      timer = setTimeout(() => {
        if (wake === onWake) wake = null;
        resolve("idle");
      }, EVENTS_HEARTBEAT_MS);
      wake = onWake;
    });

  stream.onAbort(() => {
    closed = true;
    notify();
  });

  const unsubscribe = services.events.subscribe((frame) => {
    if (overflow) return;
    if (queue.length >= SUBSCRIBER_QUEUE_MAX) {
      overflow = true;
      notify();
      return;
    }
    queue.push(frame);
    notify();
  });

  try {
    await writeFrame(stream, { type: "server.connected" });
    while (!closed && !overflow) {
      const frame = queue.shift();
      if (frame) {
        await writeFrame(stream, frame);
        continue;
      }
      if ((await waitForWork()) === "idle") await stream.write(": heartbeat\n\n");
    }
  } finally {
    unsubscribe();
  }
};

export const createEventsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/", jsonBody(emptyInputSchema), (c) =>
    streamSSE(c, (stream) => pumpEvents(stream, services)),
  );

  return router;
};
