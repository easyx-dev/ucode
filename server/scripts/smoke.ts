/**
 * 冒烟测试：不走 HTTP，直接用 pi SDK 验证「端点 + 模型 + 工具 + 流式 + codemode」是否跑通。
 *
 * codemode 只验证「沙箱能执行脚本并回传工具结果」，不验证模型工具选择的稳定性，
 * 所以提示词写得足够直接、断言足够具体；仍属 L4 手动层，不进 `pnpm check`。
 *
 * 用法（默认值即 README 里的测试端点）：
 *   pnpm -F @ucode/server smoke
 *   pnpm -F @ucode/server smoke -- --base-url http://localhost:8317/v1 --api-key devtest --model deepseek-v4-flash
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { ThinkingLevel } from "@ucode/contracts";

import { DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "../src/agent/tools/index";

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
/** 脚本里要回传的标记串，用它判断沙箱执行结果有没有真的回到正文 */
const CODEMODE_MARKER = "smoke-codemode-ok";

const root = resolve(import.meta.dirname, "..");
const workDir = resolve(root, "../.tmp/smoke");
const agentDir = resolve(workDir, "pi");
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

// codemode 走内联扩展 + defaultTools，与真实会话同一套装配方式；
// 工具名取自 agent 的常量，避免与 pi 注册名脱节后这里静默少一个工具
const settingsManager = SettingsManager.inMemory();
const resourceLoader = new DefaultResourceLoader({
  cwd: workDir,
  agentDir,
  settingsManager,
  extensionFactories: [createCodemodeExtension({ mode: "on" })],
});
await resourceLoader.reload();
// 必须在 reload 之后：reload 会重读设置，把 reload 前的 in-memory 覆盖冲掉
settingsManager.applyOverrides({
  defaultTools: [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS],
});

const { session } = await createAgentSession({
  cwd: workDir,
  agentDir,
  modelRuntime,
  model,
  thinkingLevel,
  sessionManager: SessionManager.inMemory(),
  settingsManager,
  resourceLoader,
});

/** 本轮真正执行过的工具名 */
const toolsRan: string[] = [];
session.subscribe((event) => {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") process.stdout.write(inner.delta);
      else if (inner.type === "thinking_delta")
        process.stdout.write(`\x1b[2m${inner.delta}\x1b[0m`);
      break;
    }
    case "tool_execution_start":
      toolsRan.push(event.toolName);
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

toolsRan.length = 0;
console.log("\n[smoke] codemode …\n");
await session.prompt(
  `用 codemode 工具写一段 JavaScript：在脚本里调用 tools.bash 执行 \`echo ${CODEMODE_MARKER}\`，` +
    "把命令输出通过脚本返回给我。只做这一件事。",
);
const codemodeText = session.getLastAssistantText() ?? "";
const codemodeRan = toolsRan.includes("codemode") && codemodeText.includes(CODEMODE_MARKER);
console.log(
  `\n[smoke] codemode: ${codemodeRan ? "OK" : "FAILED"}（执行过的工具：${toolsRan.join(", ") || "无"}）`,
);
session.dispose();
process.exit(codemodeRan ? 0 : 1);
