/**
 * 冒烟测试：不走 HTTP，直接用 pi SDK 验证「端点 + 模型 + 工具 + 流式」是否跑通。
 *
 * 用法（默认值即 README 里的测试端点）：
 *   pnpm -F @ucode/server smoke
 *   pnpm -F @ucode/server smoke -- --base-url http://localhost:8317/v1 --api-key devtest --model deepseek-v4-flash
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { ThinkingLevel } from "../src/config/schema";

const args = process.argv.slice(2);
const readArg = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
};

const baseUrl = readArg("base-url", "http://localhost:8317/v1");
const apiKey = readArg("api-key", "devtest");
const modelId = readArg("model", "deepseek-v4-flash");
const thinkingLevel = readArg("thinking", "medium") as ThinkingLevel;
const providerId = "local";

const root = resolve(import.meta.dirname, "..");
const workDir = resolve(root, ".tmp/smoke");
const agentDir = resolve(workDir, "agent");
mkdirSync(agentDir, { recursive: true });

const modelsPath = resolve(agentDir, "models.json");
writeFileSync(
  modelsPath,
  `${JSON.stringify(
    {
      providers: {
        [providerId]: {
          name: "Smoke Gateway",
          baseUrl,
          api: "openai-completions",
          apiKey,
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
              compat: { supportsDeveloperRole: false },
            },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const modelRuntime = await ModelRuntime.create({
  authPath: resolve(agentDir, "auth.json"),
  modelsPath,
  refreshOnCreate: false,
});

const model = modelRuntime.getModel(providerId, modelId);
if (!model) {
  console.error(`[smoke] 模型未注册: ${providerId}/${modelId}`);
  process.exit(1);
}

const { session } = await createAgentSession({
  cwd: workDir,
  agentDir,
  modelRuntime,
  model,
  thinkingLevel,
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory(),
});

session.subscribe((event) => {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") process.stdout.write(inner.delta);
      else if (inner.type === "thinking_delta") process.stdout.write(`\x1b[2m${inner.delta}\x1b[0m`);
      break;
    }
    case "tool_execution_start":
      process.stdout.write(`\n[tool] ${event.toolName} ${JSON.stringify(event.args)}\n`);
      break;
    case "tool_execution_end":
      process.stdout.write(`[tool] ${event.toolName} done (isError=${event.isError})\n`);
      break;
    default:
      break;
  }
});

console.log(`[smoke] ${providerId}/${modelId} @ ${baseUrl}`);
console.log(`[smoke] cwd=${workDir}\n`);

const startedAt = Date.now();
await session.prompt("用一句话介绍你自己，然后列出当前目录下的文件。");
const elapsed = Date.now() - startedAt;

console.log(`\n\n[smoke] OK (${(elapsed / 1000).toFixed(1)}s)`);
console.log(`[smoke] lastAssistantText: ${JSON.stringify(session.getLastAssistantText() ?? null)}`);
console.log(`[smoke] messages: ${session.messages.length}`);
session.dispose();
process.exit(0);
