import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { getBrand } from "@ucode/branding";

/**
 * MCP（Model Context Protocol）stdio 客户端。
 *
 * pi 没有内建的 MCP 支持，所以这一个模块自己说话：**one JSON-RPC 2.0 消息一行**
 * （MCP 的 stdio 传输就是这么定的），`initialize` 握手之后 `tools/list` 拿工具、
 * `tools/call` 调工具。
 *
 * 三条自我约束：
 * - 每条请求都有超时（服务器卡死不能让整轮对话挂住）；
 * - 进程退出时把所有在途请求显式失败（而不是永远 pending）；
 * - stderr 留最后几行做诊断——服务器起不来时，用户要看得到原因。
 */

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpToolResult = {
  /** 原样的 MCP content 数组（通常是 `{type:"text",text}`）。 */
  content: unknown;
  isError: boolean;
};

export type McpServerClient = {
  readonly name: string;
  readonly toolCount: number;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: unknown): Promise<McpToolResult>;
  close(): Promise<void>;
};

export type StartMcpServerOptions = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
};

/** MCP 修订版本：写死一个我们实现得了的（只用到 tools 一族方法）。 */
const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 15_000;
/** stderr 只留最后这些行：够诊断，又不会把日志吃掉。 */
const STDERR_KEEP_LINES = 20;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export async function startMcpServer(options: StartMcpServerOptions): Promise<McpServerClient> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(options.command, options.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  const pending = new Map<number, Pending>();
  const stderrLines: string[] = [];
  let nextId = 1;
  let closed = false;
  let buffer = "";

  const failAll = (message: string): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
      pending.delete(id);
    }
  };

  const onLine = (line: string): void => {
    const text = line.trim();
    if (text === "") return;
    let message: { id?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return; // 不是 JSON 的行（服务器打的日志）忽略
    }
    if (typeof message.id !== "number") return; // 通知（如 log）不配对
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error !== undefined && message.error !== null) {
      entry.reject(new Error(describeError(message.error, options.name)));
      return;
    }
    entry.resolve(message.result);
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      onLine(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (line.trim() === "") continue;
      stderrLines.push(line);
      if (stderrLines.length > STDERR_KEEP_LINES) stderrLines.shift();
    }
  });
  child.once("exit", (code) => {
    closed = true;
    failAll(
      `MCP 服务器 ${options.name} 已退出（code=${code ?? "null"}）。${stderrSummary(stderrLines)}`,
    );
  });
  child.once("error", (error: Error) => {
    closed = true;
    failAll(`MCP 服务器 ${options.name} 启动失败：${error.message}`);
  });

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`MCP 服务器 ${options.name} 已经不在。${stderrSummary(stderrLines)}`));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`MCP 请求超时（${method}，${timeoutMs}ms）。${stderrSummary(stderrLines)}`),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method: string, params: unknown): void => {
    if (closed) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: getBrand().productName, version: "0.0.0" },
  });
  notify("notifications/initialized", {});

  let toolCount = 0;
  const client: McpServerClient = {
    name: options.name,
    get toolCount(): number {
      return toolCount;
    },

    async listTools(): Promise<McpToolDescriptor[]> {
      const result = (await request("tools/list", {})) as { tools?: unknown };
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      const parsed = tools.filter(isToolDescriptor).map((tool) => ({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      }));
      toolCount = parsed.length;
      return parsed;
    },

    async callTool(name: string, args: unknown): Promise<McpToolResult> {
      const result = (await request("tools/call", { name, arguments: args ?? {} })) as {
        content?: unknown;
        isError?: unknown;
      };
      return {
        content: result?.content ?? [],
        isError: result?.isError === true,
      };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      failAll(`MCP 服务器 ${options.name} 已关闭。`);
      child.stdin.end();
      await stopProcess(child);
    },
  };
  return client;
}

function isToolDescriptor(
  value: unknown,
): value is { name: string; description?: unknown; inputSchema?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { name?: unknown }).name === "string";
}

function describeError(error: unknown, serverName: string): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return `MCP 服务器 ${serverName} 返回错误：${message}`;
  }
  return `MCP 服务器 ${serverName} 返回错误：${JSON.stringify(error)}`;
}

function stderrSummary(lines: string[]): string {
  return lines.length === 0 ? "" : `服务器 stderr：\n${lines.join("\n")}`;
}

/** 先 SIGTERM 再兜底 SIGKILL：不给不听话的子进程留孤儿。 */
async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  timer.unref?.();
  await exited;
  clearTimeout(timer);
}
