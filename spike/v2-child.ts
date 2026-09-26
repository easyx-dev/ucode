// spike/v2-child.ts —— V-2 单个实验：跑一轮 prompt，报告会话文件落点
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { listFiles } from "./lib.ts";
import { join } from "node:path";

const mode = process.env.MODE!;
const agentDir = process.env.AGENT_DIR ?? "";
const sessionDir = process.env.SESSION_DIR ?? "";
const cwd = process.env.SPIKE_CWD || process.cwd();

// baseline 不设 PI_CODING_AGENT_DIR（走 HOME 下的默认 agent-dir）
if (mode !== "baseline") process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("ucastest", "deepseek-v4-flash");
if (!model) {
  console.log(JSON.stringify({ mode, error: "model-not-found", agentDir }));
  process.exit(1);
}

const opts: Record<string, unknown> = { model, modelRuntime };
if (mode === "sessiondir-manager") opts.sessionManager = SessionManager.create(cwd, sessionDir);
else if (mode === "inmemory") opts.sessionManager = SessionManager.inMemory();

const { session } = await createAgentSession(opts as any);
let sessionFile: string | null = session.sessionFile ?? null;
try {
  await session.prompt("Reply with exactly one word: pong");
} finally {
  session.dispose();
}

const report = {
  mode,
  agentDir,
  sessionDir,
  cwd,
  sessionFile,
  jsonlUnderAgentDir: listFiles(agentDir).filter((f) => f.endsWith(".jsonl")),
  jsonlUnderSessionDir: sessionDir ? listFiles(sessionDir).filter((f) => f.endsWith(".jsonl")) : [],
  jsonlUnderDefaultAgentDir: listFiles(join(process.env.HOME ?? "", ".pi", "agent")).filter((f) => f.endsWith(".jsonl")),
};
console.log(JSON.stringify(report));
