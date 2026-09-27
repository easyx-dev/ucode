/**
 * 核心独立安装验收（spec §7.3 的第 1 条必跑验收）：
 * **只装服务层（+ 一个绑定）→ 启动 → 纯协议客户端完成握手/对话/取历史 → 退出码 0**。
 *
 *   node tools/acceptance-service-standalone.ts
 *
 * 与 `tests/e2e.test.ts` 的差别：那边从**仓库里**起服务层（workspace 链接）；这里先用
 * `pnpm build:libs` 产出各库包的 `dist`，再 `pnpm deploy` 把 `@ucode/cli` **装成一个独立目录**
 * （自带 node_modules、脱离工作区），最后跑**安装形态的入口** `dist/main.js`
 * （不经 `--conditions=dev-src`，因此走的是 exports 的 `default` → `dist/*.js`）。
 * 这就是"以包形式安装也能跑"的证据。
 *
 * 早先这条验收跑的是 esbuild 单文件 bundle——那时它只能那样跑，因为开发态的 exports 指向
 * `src/*.ts`，而 **Node 拒绝对 node_modules 下的文件做类型剥离**
 *（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。库包 emit + 条件 exports 落地后，
 * 安装形态有了真正的 `dist`，这条验收才回到 spec 描述的样子。
 *
 * 模型调用走**内置假供应商**（本地 HTTP，OpenAI 兼容）：验收不该依赖网络与真实模型。
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 1;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 协议消息：值形状由协议 C 决定，这里只做最小结构断言。 */
type ProtocolMessage = Record<string, unknown>;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** 录制式假供应商：固定回一句助手文本（SSE 流式，形状同真实 OpenAI 端点）。 */
function startFakeProvider(text: string): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "fake-model", object: "model", created: 0 }],
        }),
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(404).end("{}");
      return;
    }
    req.resume();
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const chunk = (delta: Record<string, unknown>, finish: string | null): unknown => ({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "fake-model",
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      res.write(`data: ${JSON.stringify(chunk({ role: "assistant" }, null))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk({ content: text }, null))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

type Waiter = {
  predicate: (message: ProtocolMessage) => boolean;
  resolve: (message: ProtocolMessage) => void;
};

/** 纯协议客户端：只按协议 B 的线格式收发（不依赖 sdk）。 */
class ProtocolClient {
  #child: ChildProcess;
  #buffer = "";
  #messages: ProtocolMessage[] = [];
  #waiters: Waiter[] = [];

  constructor(child: ChildProcess) {
    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8");
      for (;;) {
        const index = this.#buffer.indexOf("\n");
        if (index === -1) break;
        const line = this.#buffer.slice(0, index).trim();
        this.#buffer = this.#buffer.slice(index + 1);
        if (line === "") continue;
        let parsed: ProtocolMessage;
        try {
          parsed = JSON.parse(line) as ProtocolMessage;
        } catch {
          continue;
        }
        this.#messages.push(parsed);
        for (const waiter of [...this.#waiters]) {
          if (waiter.predicate(parsed)) {
            this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
            waiter.resolve(parsed);
          }
        }
      }
    });
  }

  send(message: unknown): void {
    this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  waitFor(
    predicate: (message: ProtocolMessage) => boolean,
    timeoutMs = 20_000,
  ): Promise<ProtocolMessage> {
    const existing = this.#messages.find(predicate);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<ProtocolMessage>((resolve, reject) => {
      const waiter: Waiter = { predicate, resolve };
      this.#waiters.push(waiter);
      setTimeout(() => {
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
        reject(new Error("等待协议消息超时"));
      }, timeoutMs);
    });
  }
}

const installDir = join(mkdtempSync(join(tmpdir(), "service-standalone-")), "app");
const dataDir = mkdtempSync(join(tmpdir(), "service-standalone-data-"));
const projectDir = mkdtempSync(join(tmpdir(), "service-standalone-proj-"));

let provider: { baseUrl: string; close(): Promise<void> } | undefined;
let child: ChildProcess | undefined;
let failed = false;

try {
  log("① 产出库包 dist 并用 pnpm deploy 装成独立目录…");
  const built = spawnSync("pnpm", ["build:libs"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (built.status !== 0) throw new Error(`build:libs 失败：${built.stderr || built.stdout}`);

  const deployed = spawnSync("pnpm", ["--filter", "@ucode/cli", "deploy", installDir, "--prod"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (deployed.status !== 0)
    throw new Error(`pnpm deploy 失败：${deployed.stderr || deployed.stdout}`);
  log(`   已装到 ${installDir}（自带 node_modules，脱离工作区）`);

  provider = await startFakeProvider("独立安装验收的回显");
  mkdirSync(join(dataDir, "v1", "pi"), { recursive: true });
  writeFileSync(
    join(dataDir, "v1", "pi", "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: provider.baseUrl,
          api: "openai-completions",
          apiKey: "fake-key",
          models: [
            {
              id: "fake-model",
              name: "Fake",
              input: ["text"],
              contextWindow: 32_000,
              maxTokens: 1_024,
            },
          ],
        },
      },
    }),
  );

  log("② 从独立目录启动服务层（安装形态：dist/main.js，嵌入式 stdio）…");
  child = spawn(
    process.execPath,
    [
      join(installDir, "dist", "main.js"),
      "service",
      "start",
      "--foreground",
      "--stdio",
      "--data-dir",
      dataDir,
      "--cwd",
      projectDir,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  // 服务层的日志走 stderr；转发出来，启动失败时才有线索。
  child.stderr?.on("data", (chunk: Buffer) =>
    process.stderr.write(`[service] ${chunk.toString("utf8")}`),
  );
  const client = new ProtocolClient(child);

  client.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    clientId: "acceptance",
    clientKind: "test",
    binding: "stdio",
    capabilities: ["sessions.read", "sessions.write", "prompt.run", "interaction.respond"],
  });
  const welcome = await client.waitFor((message) => message.type === "welcome");
  log(
    `   握手成功（coreId=${String(welcome.coreId)}，数据格式 ${String(welcome.dataFormatVersion)}）`,
  );

  const requestId = (suffix: string): string => `req-${suffix}`;
  client.send({
    type: "command",
    id: requestId("create"),
    command: "session.create",
    sessionId: null,
    args: { cwd: projectDir },
  });
  const created = await client.waitFor(
    (message) => message.type === "response" && message.id === requestId("create"),
  );
  if (created.success !== true) throw new Error(`建会话失败：${JSON.stringify(created.error)}`);
  const sessionId = (created.data as { sessionId: string }).sessionId;

  client.send({
    type: "command",
    id: requestId("attach"),
    command: "session.attach",
    sessionId,
    args: {},
  });
  await client.waitFor(
    (message) => message.type === "response" && message.id === requestId("attach"),
  );

  log("③ 走一轮对话（假供应商回显）…");
  client.send({
    type: "command",
    id: requestId("prompt"),
    command: "prompt",
    sessionId,
    args: { text: "你好" },
  });
  await client.waitFor((message) => message.type === "agent_settled", 30_000);

  client.send({
    type: "command",
    id: requestId("entries"),
    command: "session.get_entries",
    sessionId,
    args: { fromSeq: 0 },
  });
  const entries = await client.waitFor(
    (message) => message.type === "response" && message.id === requestId("entries"),
  );
  const records = (entries.data as { records: unknown[] }).records;
  if (!JSON.stringify(entries.data).includes("独立安装验收的回显")) {
    throw new Error("失败：取回的历史里没有助手回复。");
  }
  log(`   取回 ${records.length} 条记录，含助手回复。`);

  log("④ 优雅退出…");
  const exitCode = await new Promise<string | number | null>((resolve) => {
    child?.once("exit", (code) => resolve(code));
    // 先收掉 stdin（stdio 绑定的读端），再发 SIGTERM——顺序反了会让进程多等一会儿。
    child?.stdin?.end();
    child?.kill("SIGTERM");
    setTimeout(() => resolve("timeout"), 20_000);
  });
  if (exitCode !== 0) throw new Error(`失败：退出码 ${String(exitCode)}（期望 0）。`);

  log("\n✅ 通过：独立目录只装服务层即可完成 握手 → 建会话 → 对话 → 取历史 → 退出码 0。");
} catch (error) {
  failed = true;
  log(`\n❌ 失败：${error instanceof Error ? error.message : String(error)}`);
} finally {
  child?.kill("SIGKILL");
  await provider?.close().catch(() => undefined);
  const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
  await rm(installDir, rmOptions).catch(() => undefined);
  await rm(dataDir, rmOptions).catch(() => undefined);
  await rm(projectDir, rmOptions).catch(() => undefined);
}

process.exit(failed ? 1 : 0);
