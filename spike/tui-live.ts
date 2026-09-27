// spike/tui-live.ts —— TUI 渲染链路对真实核心层 + 真实模型的无终端冒烟
//
//   cd spike && node tui-live.ts
//
// TUI 的交互需要 TTY，无法在脚本里跑完整按键流程；这里验证的是**数据与渲染链路**：
// 起真实核心层进程 → SDK 走 stdio → 真实模型跑一轮 → 用 apps/tui 的 view.ts 渲染出终端行。
// 交互层（Input/SelectList/按键）由 apps/tui/src/view.test.ts 的渲染单测覆盖。
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../packages/sdk/src/agent-sdk.ts";
import type { Transport } from "../packages/sdk/src/index.ts";
import { toDisplayItems } from "../packages/sdk/src/reducer.ts";
import { statusLine, transcriptLines } from "../apps/tui/src/view.ts";
import { PROVIDER, PROVIDER_NAME } from "./lib.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** 数据层目录：模型限额调大（推理模型会把额度花在 reasoning 上，太小则正文为空）。 */
const dataDir = mkdtempSync(join(tmpdir(), "tui-agent-"));
mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        [PROVIDER_NAME]: {
          baseUrl: PROVIDER.baseUrl,
          api: "openai-completions",
          apiKey: PROVIDER.apiKey,
          models: [
            {
              id: PROVIDER.model,
              name: "Smoke Model",
              input: ["text"],
              contextWindow: 32_000,
              maxTokens: 4_096,
            },
          ],
        },
      },
    },
    null,
    2,
  ),
);

const cwd = mkdtempSync(join(tmpdir(), "tui-work-"));

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const core = spawn(
  process.execPath,
  [
    // 子进程要显式带上条件，否则走 exports 的 default → dist（测到的会是旧构建产物）
    "--conditions=dev-src",
    join(repoRoot, "apps/cli/src/main.ts"),
    "core",
    "start",
    "--binding",
    "stdio",
    "--data-dir",
    dataDir,
    "--cwd",
    cwd,
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
core.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[core] ${chunk.toString("utf8")}`));

/** 复用核心层子进程的管道直接构造 stdio 传输（避免再 spawn 一个核心层）。 */
function stdioTransport(): Transport {
  return {
    kind: "stdio",
    send: (message) => {
      core.stdin.write(`${JSON.stringify(message)}\n`);
    },
    onMessage: (handler) => {
      let buffer = "";
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString("utf8");
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.trim() !== "") {
            try {
              handler(JSON.parse(line));
            } catch {
              // 非协议行（日志）忽略
            }
          }
          index = buffer.indexOf("\n");
        }
      };
      core.stdout.on("data", onData);
      return () => core.stdout.off("data", onData);
    },
    onClose: (handler) => {
      core.on("exit", () => handler("核心层进程退出"));
      return () => undefined;
    },
    onError: () => undefined,
    close: async () => undefined,
    ready: async () => undefined,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待超时：${what}`);
}

let failed = false;
try {
  const sdk = await connect({
    transport: stdioTransport(),
    clientKind: "tui",
    capabilities: [
      "sessions.read",
      "sessions.write",
      "prompt.run",
      "interaction.respond",
      "channel.workspace",
    ],
    requestTimeoutMs: 120_000,
  });
  await sdk.connect();

  const token = `ZEBRA-${Math.floor(Math.random() * 9000 + 1000)}`;
  const { sessionId } = await sdk.createSession({ cwd });
  await sdk.attachSession(sessionId);
  log(`① 已建会话 ${sessionId}，发一轮真实对话（要它回答 ${token}）…`);
  await sdk.prompt(sessionId, `请只回答这一个代号，不要别的字：${token}`);

  // 等到**助手正文**真的落进视图（不只是用户那条）。
  try {
    await waitFor(
      // 注意：pi-tui 的 Text 会加前导空白，所以用 includes 而不是 startsWith。
      () =>
        transcriptLines(sdk.state.views[sessionId] ?? emptyView(), { width: 80 }).some((line) =>
          line.includes("助手 >"),
        ),
      45_000,
      "助手回复",
    );
  } catch (error) {
    // 诊断：转储记录，看清"到底落盘了什么"（区分"模型只出推理"与"根本没回"）。
    const { records } = await sdk.getEntries(sessionId, 0);
    log(`[诊断] 记录数=${records.length}`);
    for (const record of records) {
      const entry = record.entry as Record<string, unknown>;
      const message = entry.message as { role?: string; content?: unknown } | undefined;
      const text =
        typeof message?.content === "string"
          ? message.content
          : JSON.stringify(message?.content ?? "").slice(0, 200);
      log(`   seq=${record.seq} type=${String(entry.type)} role=${message?.role ?? "-"} ${text}`);
    }
    const view = sdk.state.views[sessionId];
    log(
      `[诊断] view.entries=${view?.entries.length ?? -1} ids=${(view?.entries ?? [])
        .map((entry) => `${entry.type}:${entry.id}`)
        .join(",")}`,
    );
    log(`[诊断] running=${String(view?.running)} lastError=${JSON.stringify(view?.lastError)}`);
    log(`[诊断] activeSessionId=${String(sdk.state.activeSessionId)}`);
    throw error;
  }

  const view = sdk.state.views[sessionId];
  if (view === undefined) throw new Error("失败：SDK 里没有该会话的视图。");
  const lines = transcriptLines(view, { width: 80 });
  const rendered = lines.join("\n");
  log("② 展示项转储（诊断）：");
  for (const item of toDisplayItems(view)) {
    log(
      `   - kind=${item.kind} ${
        item.kind === "assistant"
          ? JSON.stringify(item.markdown)
          : item.kind === "user"
            ? JSON.stringify(item.text)
            : item.kind
      }`,
    );
  }
  log("②b 用 apps/tui 的 view.ts 渲染：");
  for (const line of lines) if (line.trim() !== "") log(`   | ${line}`);

  // 空白不敏感：Text 会加前导空白，且长行可能被折行。
  const compact = rendered.replace(/\s+/gu, "");
  if (!compact.includes(`助手>${token}`)) {
    throw new Error(`失败：助手回复里没有代号 ${token}。`);
  }
  log(
    `③ 状态栏：${statusLine({
      productName: "tui-smoke",
      connected: sdk.state.connected,
      trustLevel: sdk.state.trustLevel,
      sessionCount: sdk.state.sessions.length,
      view,
      model: view.state?.model?.modelId ?? null,
    })}`,
  );

  await sdk.close();
  log("\n✅ 通过：真实核心层 + 真实模型 → SDK 状态 → TUI 视图渲染出助手回复。");
} catch (error) {
  failed = true;
  log(`\n❌ 失败：${error instanceof Error ? error.message : String(error)}`);
} finally {
  const exited = new Promise<void>((resolve) => core.once("exit", () => resolve()));
  core.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;
  await rm(dataDir, rmOptions);
  await rm(cwd, rmOptions);
}

function emptyView() {
  return {
    id: "",
    summary: null,
    state: null,
    entries: [],
    seqByEntryId: {},
    maxSeq: 0,
    streaming: { text: "", thinking: "" },
    running: false,
    pendingInteractions: 0,
    usage: null,
    lastError: null,
    needsResync: false,
    readOnly: false,
  } as unknown as import("../packages/sdk/src/index.ts").SessionView;
}

// 显式退出：SDK 的重连定时器等句柄会让事件循环不空。
process.exit(failed ? 1 : 0);
