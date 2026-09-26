import type { CoreServer, ServerMessage, TransportBinding, TrustLevel } from "@ucode/protocol";
import { parseErrorResponse } from "@ucode/protocol";

/**
 * stdio 绑定（协议 B）：行分隔 JSON（JSONL）。
 *
 * **必须按字节切分，禁止使用语言内置的行读取器**（spec §5.5）——原因不是风格：
 * JSON 字符串里可以合法包含 `U+2028`/`U+2029`，部分运行时的行读取器会把它们当作换行，
 * 导致消息被静默截断。这里只认 `0x0a` 这个字节。
 *
 * 信任级别是 **implicit**：对端由本进程的父进程 spawn，等价于"这台机器的主人"。
 */

export type StdioBindingOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** 仅测试用；正常情况下 stdio 的信任级别就是 implicit。 */
  trustLevel?: TrustLevel;
};

const NEWLINE = 0x0a;

export function createBinding(
  core: CoreServer,
  options: StdioBindingOptions = {},
): TransportBinding {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const trustLevel: TrustLevel = options.trustLevel ?? "implicit";

  let connection: ReturnType<CoreServer["attachConnection"]> | undefined;
  let buffer: Buffer = Buffer.alloc(0);
  let closed = false;
  const pendingWrites: string[] = [];
  let draining = false;

  function flush(): void {
    while (!draining && pendingWrites.length > 0) {
      const next = pendingWrites.shift();
      if (next === undefined) break;
      const ok = output.write(next);
      if (!ok) {
        draining = true;
        output.once?.("drain", () => {
          draining = false;
          flush();
        });
        return;
      }
    }
  }

  const send = (message: ServerMessage): void => {
    // 一条消息一行。JSON.stringify 不转义 U+2028/U+2029，这没问题——我们只按 0x0a 切分。
    pendingWrites.push(`${JSON.stringify(message)}\n`);
    flush();
  };

  async function handleLine(text: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      send(
        parseErrorResponse(`消息不是合法 JSON：${error instanceof Error ? error.message : text}`),
      );
      return;
    }
    await connection?.receive(value);
  }

  const onData = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    buffer = buffer.length === 0 ? bytes : Buffer.concat([buffer, bytes]);
    for (;;) {
      const index = buffer.indexOf(NEWLINE);
      if (index === -1) break;
      const line = buffer.subarray(0, index);
      buffer = buffer.subarray(index + 1);
      const text = line.toString("utf8").replace(/\r$/, "");
      if (text.trim() === "") continue;
      void handleLine(text);
    }
  };

  const binding: TransportBinding = {
    name: "stdio",
    trustLevel,
    async start() {
      connection = core.attachConnection({ binding: "stdio", trustLevel, send });
      input.on("data", onData);
      input.on?.("end", () => {
        void binding.stop();
      });
    },
    async stop() {
      if (closed) return;
      closed = true;
      input.off?.("data", onData);
      await connection?.close();
      connection = undefined;
    },
    connectionCount: () => (connection === undefined ? 0 : 1),
  };

  return binding;
}
