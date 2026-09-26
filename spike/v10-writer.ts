// spike/v10-writer.ts —— V-10 写入方：建会话，然后按节奏追加 N 条 entry
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAgentDir, PROVIDER_NAME } from "./lib.ts";

const N = Number(process.env.V10_APPENDS ?? "20");
const DELAY = Number(process.env.V10_DELAY ?? "40");

const agentDir = makeAgentDir();
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";
const sess = mkdtempSync(join(tmpdir(), "ucode-v10-sess-"));
const rt = await ModelRuntime.create();
const model = rt.getModel(PROVIDER_NAME, process.env.SPIKE_MODEL ?? "deepseek-v4-flash")!;
const mgr = SessionManager.create(process.cwd(), sess);
const { session } = await createAgentSession({ model, modelRuntime: rt, sessionManager: mgr } as any);
await session.prompt("Reply with exactly one word: start");
const file = session.sessionFile!;

// 首行告知 reader 目标文件
console.log(`FILE ${file}`);
for (let i = 0; i < N; i++) {
  mgr.appendCustomEntry("v10-tick", { i, at: Date.now() });
  await new Promise((r) => setTimeout(r, DELAY));
}
session.dispose();
console.log("DONE");
