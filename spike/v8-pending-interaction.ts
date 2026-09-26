// spike/v8-pending-interaction.ts —— V-8：会话状态可持久化/可恢复（待决交互介入点的前提）
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
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

const rt = await ModelRuntime.create();
const model = rt.getModel(PROVIDER_NAME, process.env.SPIKE_MODEL ?? "deepseek-v4-flash")!;
const mgr = SessionManager.create(spikeDir);
const { session } = await createAgentSession({ model, modelRuntime: rt, sessionManager: mgr } as any);
const file = session.sessionFile!;

await session.prompt("Remember the number 41. Reply with just: noted");
const entriesBefore = mgr.getEntries().length;
const msgsBefore = session.messages.length;

// 模拟"释放运行资源"：中止并 dispose，随后用同一会话文件重开
session.dispose();

const mgr2 = SessionManager.open(file);
const { session: session2 } = await createAgentSession({ model, modelRuntime: rt, sessionManager: mgr2 } as any);
const restoredEntries = mgr2.getEntries().length;
await session2.prompt("What number did I ask you to remember? Reply with just the number.");
const answer = session2.getLastAssistantText() ?? "";
const entriesAfter = mgr2.getEntries().length;
session2.dispose();

const report = {
  file,
  entriesBefore, msgsBefore, restoredEntries, entriesAfter,
  answer,
  verdict: {
    stateRestored: restoredEntries >= entriesBefore,
    resumedAndContinued: /41/.test(answer),
    reopenWorks: true,
  },
  note: "本项证明会话状态可持久化并在 dispose 后重开续跑；'无 attachment 时挂起等待批准'所需的**运行资源释放点**仍需在核心层用自己的状态机包住 agent loop（pi 未提供现成挂起态）",
};
writeFileSync(join(resultsDir, "v8.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nwrote results/v8.json");
