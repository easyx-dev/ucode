import { type ChildProcess, spawn } from "node:child_process";
import type { Transport } from "@ucode/protocol";

/**
 * stdio 的**客户端一侧**：按字节切分 JSONL。
 *
 * 服务端一侧在 `./index.ts`（绑定把核心层接到 stdio 上）；
 * 这一侧是"我去连一个把核心层挂在 stdio 上的进程"——TUI 与桌面壳都用它。
 */

export type StdioClientOptions = {
  /** 要 spawn 的核心层命令；省略则用当前进程的 stdin/stdout。 */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export function createStdioClient(options: StdioClientOptions = {}): Transport {
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const errorHandlers: ((error: Error) => void)[] = [];
  let child: ChildProcess | undefined;
  let buffer: Buffer = Buffer.alloc(0);
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const onData = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    buffer = buffer.length === 0 ? Buffer.from(bytes) : Buffer.concat([buffer, bytes]);
    for (;;) {
      const index = buffer.indexOf(0x0a);
      if (index === -1) break;
      const line = buffer.subarray(0, index).toString("utf8").trim();
      buffer = buffer.subarray(index + 1);
      if (line === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        for (const handler of messageHandlers) handler(parsed);
      } catch {
        // 忽略非 JSON 行：绑定不做协议语义判断
        for (const handler of messageHandlers) handler({ type: "__malformed_line", line });
      }
    }
  };

  const input = (): NodeJS.ReadableStream => child?.stdout ?? process.stdin;
  const output = (): NodeJS.WritableStream => child?.stdin ?? process.stdout;

  if (options.command !== undefined) {
    const spawned = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    child = spawned;
    spawned.once("spawn", () => resolveReady?.());
    spawned.on("error", (error: Error) => {
      for (const handler of errorHandlers) handler(error);
    });
    spawned.on("exit", (code) => {
      for (const handler of closeHandlers) handler(`核心层进程退出（code=${code ?? "null"}）`);
    });
  } else {
    resolveReady?.();
  }
  input().on("data", onData);

  return {
    kind: "stdio",
    send(message) {
      output().write(`${JSON.stringify(message)}\n`);
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
      input().off?.("data", onData);
      if (child !== undefined) {
        child.kill();
        child = undefined;
      }
    },
    ready: () => readyPromise,
  };
}
