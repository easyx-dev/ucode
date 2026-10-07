/** 解析 Hono streamSSE 输出：`event: x\ndata: y\n\n` */
export const readSseStream = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
  /** 每读到一段数据（含注释行心跳）时回调：调用方的连接看门狗靠它判活 */
  onActivity?: () => void,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        dispatchFrame(frame, onEvent);
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
};

const dispatchFrame = (frame: string, onEvent: (event: string, data: unknown) => void): void => {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return;
  const raw = dataLines.join("\n");

  try {
    onEvent(event, JSON.parse(raw) as unknown);
  } catch {
    onEvent(event, raw);
  }
};
