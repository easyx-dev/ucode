/**
 * 事件流的读与拆帧：分帧与字段解析按 SSE 规范交给 eventsource-parser，这里只负责读流、报活与回落。
 *
 * 心跳（`: ...` 注释行）不进业务回调，但每读到一段数据都会调 `onActivity`——连接看门狗靠它判活，
 * 所以拆帧交给库、报活留在这一层（见 `events.ts` 的退避重连）。
 */
import { createParser } from "eventsource-parser";

/** 单条事件的缓冲上限：畸形或恶意流不该把内存吃满（库默认不设上限） */
const MAX_FRAME_BYTES = 1024 * 1024;

export const readSseStream = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
  onActivity?: () => void,
): Promise<void> => {
  // 超限时库只回调 `onError` 并把自己置为终止态（要等下一次 feed 才抛）：这里当场记下、读完这一段就结束，
  // 否则被丢掉的那条事件既不报错，也要等下一段数据才暴露
  let parseError: Error | undefined;
  const parser = createParser({
    maxBufferSize: MAX_FRAME_BYTES,
    onError: (error) => {
      parseError = error;
    },
    onEvent: (message) => {
      const event = message.event ?? "message";
      try {
        onEvent(event, JSON.parse(message.data) as unknown);
      } catch {
        // 不是 JSON 就按原文交给调用方（错误帧的 message 等场景）
        onEvent(event, message.data);
      }
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.();
      parser.feed(decoder.decode(value, { stream: true }));
      const failure = parseError;
      if (failure) throw failure;
    }
  } finally {
    // 提前退出（中止或拆帧失败）时主动关流：只 releaseLock 会把响应体与它占着的连接一直挂着
    await reader.cancel().catch(() => {});
  }
};
