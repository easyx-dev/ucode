import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

/**
 * 录制式假模型供应商（spec §7.4：「假模型供应商是必要设施」）。
 *
 * 做法是**在本地起一个 OpenAI 兼容端点**，而不是替换基座内部的 provider 实现：
 * - 走的是真实的 HTTP 调用路径（pi 的客户端、SSE 解析、重试逻辑都被覆盖）；
 * - 不依赖任何基座内部类型，因此基座升级时不容易被牵连；
 * - 测试不需要网络、不需要密钥、结果确定。
 *
 * 供应商配置沿用基座约定（与 `spike/lib.ts` 验证过的形状一致）：
 * `api: "openai-completions"`、`models[].id`，端点 `${baseUrl}/chat/completions`。
 */

export type FakeToolCall = {
  name: string;
  args: Record<string, unknown>;
  /** 默认 "call-<n>"。 */
  id?: string;
};

export type FakeReply = {
  /** 依次流式吐出的文本片段；缺省时用 `text` 一次性给出。 */
  chunks?: string[];
  text?: string;
  /** 先吐文本再发起工具调用（工具执行由核心层与基座完成）。 */
  toolCalls?: FakeToolCall[];
  /** 用于断言"识别错误"这类路径。 */
  status?: number;
  errorBody?: string;
};

export type FakeProvider = {
  /** 形如 http://127.0.0.1:PORT/v1。 */
  baseUrl: string;
  providerId: string;
  modelId: string;
  /** 收到的请求（用于断言"模型真的被调用了"以及检查提示词）。 */
  requests: { messages: unknown[]; tools: unknown[] }[];
  /** 依次出队的回复；队列空时用 defaultReply。 */
  queue(replies: FakeReply[]): void;
  close(): Promise<void>;
  /** 把 models.json 写进指定的 agent 目录（数据层目录即 agent 目录）。 */
  writeModelsJson(agentDir: string): Promise<void>;
};

const DEFAULT_REPLY: FakeReply = { text: "好的。" };

export async function startFakeProvider(
  options: { providerId?: string; modelId?: string; defaultReply?: FakeReply } = {},
): Promise<FakeProvider> {
  const providerId = options.providerId ?? "fake";
  const modelId = options.modelId ?? "fake-model";
  const pending: FakeReply[] = [];
  const requests: { messages: unknown[]; tools: unknown[] }[] = [];

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: modelId, object: "model", created: 0, owned_by: providerId }],
        }),
      );
      return;
    }

    if (req.method !== "POST" || !url.includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `未知路径 ${url}` } }));
      return;
    }

    const body = await readBody(req);
    let parsed: { messages?: unknown[]; tools?: unknown[]; stream?: boolean } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      parsed = {};
    }
    requests.push({ messages: parsed.messages ?? [], tools: parsed.tools ?? [] });

    const reply = pending.shift() ?? options.defaultReply ?? DEFAULT_REPLY;
    if (reply.status !== undefined) {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(reply.errorBody ?? JSON.stringify({ error: { message: "fake error" } }));
      return;
    }

    if (parsed.stream === false) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completionBody(reply, modelId)));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const id = `chatcmpl-${requests.length}`;
    const created = Math.floor(Date.now() / 1000);
    const send = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send(chunk(id, created, modelId, { role: "assistant" }, null));
    const chunks = reply.chunks ?? splitText(reply.text ?? "");
    for (const piece of chunks) {
      send(chunk(id, created, modelId, { content: piece }, null));
    }
    if (reply.toolCalls !== undefined) {
      reply.toolCalls.forEach((call, index) => {
        send(
          chunk(
            id,
            created,
            modelId,
            {
              tool_calls: [
                {
                  index,
                  id: call.id ?? `call-${index + 1}`,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                },
              ],
            },
            null,
          ),
        );
      });
    }
    send(chunk(id, created, modelId, {}, reply.toolCalls === undefined ? "stop" : "tool_calls"));
    send({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    providerId,
    modelId,
    requests,
    queue: (replies) => {
      pending.push(...replies);
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    writeModelsJson: async (agentDir) => {
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "models.json"),
        JSON.stringify(
          {
            providers: {
              [providerId]: {
                baseUrl: `http://127.0.0.1:${port}/v1`,
                api: "openai-completions",
                apiKey: "fake-key",
                models: [
                  {
                    id: modelId,
                    name: "Fake Model",
                    input: ["text"],
                    contextWindow: 32_000,
                    maxTokens: 1_024,
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
    },
  };
}

function splitText(text: string): string[] {
  if (text === "") return [];
  const size = 3;
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size));
  }
  return parts;
}

function chunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): unknown {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function completionBody(reply: FakeReply, model: string): unknown {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: reply.text ?? (reply.chunks ?? []).join(""),
          ...(reply.toolCalls === undefined
            ? {}
            : {
                tool_calls: reply.toolCalls.map((call, index) => ({
                  id: call.id ?? `call-${index + 1}`,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                })),
              }),
        },
        finish_reason: reply.toolCalls === undefined ? "stop" : "tool_calls",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => parts.push(chunk));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}
