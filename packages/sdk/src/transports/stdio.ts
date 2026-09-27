import { type ChildProcess, spawn } from "node:child_process";
import type { Transport } from "@ucode/protocol";

/**
 * stdio 的**客户端一侧**：按字节切分 JSONL。
 *
 * 服务端一侧在 `./index.ts`（绑定把服务层接到 stdio 上）；
 * 这一侧是"我去连一个把服务层挂在 stdio 上的进程"——TUI 与桌面壳都用它。
 */

export type StdioClientOptions = {
  /** 要 spawn 的服务层命令；省略则用当前进程的 stdin/stdout。 */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export function createClient(options: StdioClientOptions = {}): Transport {
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
      for (const handler of closeHandlers) handler(`服务层进程退出（code=${code ?? "null"}）`);
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
      const running = child;
      child = undefined;
      if (running === undefined || running.exitCode !== null || running.signalCode !== null) return;
      // 先礼后兵：SIGTERM 让服务层有机会收尾（释放 owner 租约、关 PTY），
      // 短暂等待后仍然活着就 SIGKILL——**stdio 通路自己拉起的服务层是有代价的**：
      // 留下的孤儿进程会继续持有会话的 owner 租约，下一次启动的新实例只能只读挂载。
      // （壳的默认路径不这么用：它连 `service` 起的常驻服务，服务不随壳退出。）
      const exited = new Promise<void>((resolve) => {
        running.once("exit", () => resolve());
      });
      running.kill();
      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_000)),
      ]);
      if (timedOut) running.kill("SIGKILL");
    },
    ready: () => readyPromise,
  };
}
