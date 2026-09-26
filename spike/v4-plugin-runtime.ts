// spike/v4-plugin-runtime.ts —— V-4：pi extension 运行时可嵌入非 pi 宿主
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeAgentDir, PROVIDER_NAME } from "./lib.ts";

const spikeDir = import.meta.dirname;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });

const agentDir = makeAgentDir();
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

// 用 DefaultResourceLoader 显式指定两个测试插件（非 pi CLI 宿主）
const resourceLoader = new DefaultResourceLoader({
  cwd: spikeDir,
  agentDir: getAgentDir(),
  additionalExtensionPaths: [join(spikeDir, "fixtures", "plugin-a.ts"), join(spikeDir, "fixtures", "plugin-b.ts")],
});
await resourceLoader.reload();
const ext = resourceLoader.getExtensions();

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(PROVIDER_NAME, process.env.SPIKE_MODEL ?? "deepseek-v4-flash");
if (!model) { console.error("model-not-found"); process.exit(1); }

const { session } = await createAgentSession({
  model,
  modelRuntime,
  resourceLoader,
  sessionManager: SessionManager.inMemory(),
} as any);

let lastText = "";
let toolResultText = "";
try {
  session.subscribe((event: any) => {
    if (event.type === "tool_result") {
      const t = JSON.stringify(event).match(/"text":"([^"]*)"/g)?.join(" ");
      if (t) toolResultText += t;
    }
  });
  await session.prompt("Use the spike_echo tool with input exactly 'hi'. Then reply with the exact text the tool returned.");
  lastText = session.getLastAssistantText() ?? "";
} finally {
  session.dispose();
}

const a = (globalThis as any).__spikePluginA;
const b = (globalThis as any).__spikePluginB;

const report = {
  host: "sdk (非 pi CLI)",
  extensionsLoaded: (ext as any)?.extensions?.length ?? null,
  extensionErrors: (ext as any)?.errors ?? null,
  pluginALoaded: a?.loaded === true,
  pluginBLoaded: b?.loaded === true,
  pluginAEvents: a?.events ?? [],
  crossPluginReceived: b?.received ?? [],
  toolExecuted: /Processed:\s*hi/.test(lastText) || /Processed:\s*hi/.test(toolResultText),
  lastText,
  verdict: {
    pluginsLoaded: a?.loaded === true && b?.loaded === true,
    registerToolWorks: /Processed:\s*hi/.test(lastText),
    eventSubscriptionWorks: (a?.events ?? []).some((e: string) => e.startsWith("tool_call:")),
    crossPluginBusWorks: (b?.received ?? []).length > 0,
  },
};

writeFileSync(join(resultsDir, "v4.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nwrote results/v4.json");
