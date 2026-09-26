// spike/smoke.ts —— 冒烟：验证供应商与 SDK 可用
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { makeAgentDir } from "./lib.ts";

const agentDir = makeAgentDir();
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("ucastest", "deepseek-v4-flash");
console.log("agentDir:", agentDir);
console.log("model:", model ? `${model.provider}/${model.id}` : "(not found)");
if (!model) {
  const avail = await modelRuntime.getAvailable();
  console.log("available:", avail.map((m) => `${m.provider}/${m.id}`));
  process.exit(1);
}

const { session } = await createAgentSession({ model, modelRuntime });
console.log("sessionFile:", session.sessionFile ?? "(none)");
try {
  await session.prompt("Reply with exactly one word: pong");
  console.log("assistant:", session.getLastAssistantText());
} finally {
  session.dispose();
}
