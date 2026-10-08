/** 事件流读流与拆帧单测：分帧、字段解析、报活与缓冲上限 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readSseStream } from "../sse";

/** 把若干片字符串拼成流，用来模拟真实的网络分包 */
const streamOf = (chunks: readonly string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

const collect = async (
  chunks: readonly string[],
  signal?: AbortSignal,
): Promise<{ frames: { event: string; data: unknown }[]; activity: number }> => {
  const frames: { event: string; data: unknown }[] = [];
  let activity = 0;
  await readSseStream(
    streamOf(chunks),
    (event, data) => frames.push({ event, data }),
    signal,
    () => {
      activity += 1;
    },
  );
  return { frames, activity };
};

test("拆出事件名与 JSON 载荷，未声明事件名时按 message", async () => {
  const { frames } = await collect([
    'event: message\ndata: {"type":"a"}\n\n',
    'data: {"type":"b"}\n\n',
  ]);
  assert.deepEqual(frames, [
    { event: "message", data: { type: "a" } },
    { event: "message", data: { type: "b" } },
  ]);
});

test("被切开的分片也能拼回一帧", async () => {
  const { frames } = await collect(["event: mess", 'age\ndata: {"ty', 'pe":"a"}\n', "\n"]);
  assert.deepEqual(frames, [{ event: "message", data: { type: "a" } }]);
});

test("多行 data 按换行拼接，非 JSON 按原文回落", async () => {
  const { frames } = await collect(["event: error\ndata: 第一行\ndata: 第二行\n\n"]);
  assert.deepEqual(frames, [{ event: "error", data: "第一行\n第二行" }]);
});

test("CRLF 分帧同样识别", async () => {
  const { frames } = await collect(['data: {"type":"a"}\r\n\r\n']);
  assert.deepEqual(frames, [{ event: "message", data: { type: "a" } }]);
});

test("注释行（心跳）不进回调，但每读到一段数据都算一次活动", async () => {
  const { frames, activity } = await collect([": heartbeat\n\n", 'data: {"type":"a"}\n\n']);
  assert.deepEqual(frames, [{ event: "message", data: { type: "a" } }]);
  assert.equal(activity, 2);
});

test("已中止的 signal 不再读流", async () => {
  const controller = new AbortController();
  controller.abort();
  const { frames, activity } = await collect(['data: {"type":"a"}\n\n'], controller.signal);
  assert.deepEqual(frames, []);
  assert.equal(activity, 0);
});

test("单条事件超过缓冲上限即结束读流报错，不静默丢数据", async () => {
  const oversized = `data: ${"x".repeat(1024 * 1024)}`;
  await assert.rejects(() => collect([oversized]), /max buffer size/);
});
