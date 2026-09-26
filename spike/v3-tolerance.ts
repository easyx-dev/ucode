// spike/v3-tolerance.ts —— V-3：pi 是否容忍会话目录下的非会话文件
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAgentDir } from "./lib.ts";

const spikeDir = import.meta.dirname;
const cwd = spikeDir;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });

const agentDir = makeAgentDir();
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("ucastest", "deepseek-v4-flash")!;

// 用默认 session 目录，制造 --<encoded-cwd>-- 分桶
const manager = SessionManager.create(cwd);
const { session } = await createAgentSession({ model, modelRuntime, sessionManager: manager } as any);
await session.prompt("Reply with exactly one word: pong");
const validFile = session.sessionFile!;
session.dispose();

const bucket = join(validFile, "..");
const report: any = { agentDir, bucket, validFile, junkInjected: [], listResult: null, openResult: null, findByIdResult: null };

// 注入非会话文件与一个非法 .jsonl
try {
  mkdirSync(join(bucket, "junkdir"), { recursive: true });
  writeFileSync(join(bucket, "junkdir", "nested.txt"), "x");
  writeFileSync(join(bucket, "index.json"), JSON.stringify({ note: "not a session" }));
  writeFileSync(join(bucket, "x.lock"), "");
  writeFileSync(join(bucket, "bad.jsonl"), "this is not json\n{\"broken\": \n");
  report.junkInjected = ["junkdir/", "index.json", "x.lock", "bad.jsonl"];
} catch (e: any) { report.injectError = String(e?.message ?? e); }

// 1) 列出会话
try {
  const list = await SessionManager.list(cwd);
  report.listResult = {
    ok: true,
    count: list.length,
    sessions: list.map((s) => ({ id: s.id, path: s.path, firstMessage: (s.firstMessage ?? "").slice(0, 40) })),
    includesJunk: list.some((s) => s.path.includes("index.json") || s.path.includes("bad.jsonl")),
  };
} catch (e: any) { report.listResult = { ok: false, error: String(e?.message ?? e) }; }

// 2) 按路径打开会话
try {
  const opened = SessionManager.open(validFile);
  report.openResult = { ok: true, sessionId: opened.getSessionId(), entries: opened.getEntries().length };
} catch (e: any) { report.openResult = { ok: false, error: String(e?.message ?? e) }; }

// 3) 按 id 加载
try {
  const id = validFile.split("_").pop()!.replace(".jsonl", "");
  const found = SessionManager.findById(cwd, id);
  report.findByIdResult = { ok: true, found: found ?? null };
} catch (e: any) { report.findByIdResult = { ok: false, error: String(e?.message ?? e) }; }

// 4) 列目录内容以核对
report.bucketEntries = existsSync(bucket) ? readdirSync(bucket) : [];

report.verdict = {
  listToleratesJunk: report.listResult?.ok === true && report.listResult?.includesJunk !== true,
  openToleratesJunk: report.openResult?.ok === true,
  findByIdToleratesJunk: report.findByIdResult?.ok === true,
};

writeFileSync(join(resultsDir, "v3.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nwrote results/v3.json");
