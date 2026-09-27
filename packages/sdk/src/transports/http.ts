import type { Transport } from "@ucode/protocol";

/**
 * HTTP + SSE 的**客户端一侧**：下行 SSE 推、上行 POST 提交。
 *
 * 用 `fetch` + 手写 SSE 解析，不用 `EventSource`：浏览器有 `EventSource`、Node 24 却没有全局
 * 的它，而 sdk 要保持 headless 且两侧复用。手写解析只有几十行，换来"同一份代码在浏览器与
 * 终端里都能跑"。
 */

export type HttpClientOptions = {
  /** 形如 http://127.0.0.1:3000；浏览器里通常传 location.origin。 */
  baseUrl: string;
  clientId: string;
  fetchImpl?: typeof fetch;
  reconnectDelayMs?: number;
};

export function createClient(options: HttpClientOptions): Transport {
  const doFetch = options.fetchImpl ?? fetch;
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const errorHandlers: ((error: Error) => void)[] = [];
  let abort: AbortController | undefined;
  let closed = false;
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  async function openStream(): Promise<void> {
    abort = new AbortController();
    const response = await doFetch(
      `${options.baseUrl}/events?clientId=${encodeURIComponent(options.clientId)}`,
      { headers: { accept: "text/event-stream" }, signal: abort.signal },
    );
    if (response.body === null) throw new Error("事件流没有响应体");
    resolveReady?.();
    resolveReady = undefined;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let boundary = pending.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data !== "") deliver(data);
        boundary = pending.indexOf("\n\n");
      }
    }
  }

  function deliver(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    // 传输级控制帧（stream.ready / stream.ping）也交给上层：sdk 用 stream.ready 判断"该续传了"
    for (const handler of messageHandlers) handler(parsed);
  }

  async function loop(): Promise<void> {
    let delay = options.reconnectDelayMs ?? 500;
    while (!closed) {
      try {
        await openStream();
        delay = options.reconnectDelayMs ?? 500;
      } catch (error) {
        if (closed) return;
        for (const handler of errorHandlers) {
          handler(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (closed) return;
      // 断线：先通知上层（它会带游标重连），退避后再开流
      for (const handler of closeHandlers) handler("事件流中断");
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8_000);
    }
  }
  void loop();

  return {
    kind: "http",
    send(message) {
      void doFetch(`${options.baseUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": options.clientId },
        body: JSON.stringify(message),
      }).catch((error: unknown) => {
        for (const handler of errorHandlers) {
          handler(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    onError(handler) {
      errorHandlers.push(handler);
    },
    async close() {
      closed = true;
      abort?.abort();
    },
    ready: () => readyPromise,
  };
}
