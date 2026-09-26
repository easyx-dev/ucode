// spike/v1-append-only.ts —— V-1：会话文件是否严格只追加（含 V-5 迁移写回）
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAgentDir, snapshot, isPrefixExtension } from "./lib.ts";

const spikeDir = import.meta.dirname;
const cwd = spikeDir;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });

type Snap = { size: number; sha256: string; inode: number; content: string };

function record(name: string, file: string, prev: Snap | null, extra: Record<string, unknown> = {}) {
  const s: Snap = existsSync(file) ? snapshot(file) : { size: 0, sha256: "", inode: 0, content: "" };
  const row = {
    name,
    ...extra,
    size: s.size,
    sha256: s.sha256.slice(0, 16),
    inode: s.inode,
    prefixOk: prev ? isPrefixExtension(prev.content, s.content) : true,
    sizeMonotonic: prev ? s.size >= prev.size : true,
    inodeSame: prev ? s.inode === prev.inode : true,
  };
  console.log(JSON.stringify(row));
  return { row, snap: s };
}

function runStep(name: string, file: string, prev: Snap | null, fn: () => void, rows: any[]) {
  let extra: Record<string, unknown> = {};
  try {
    fn();
  } catch (e: any) {
    extra = { error: String(e?.message ?? e) };
  }
  const { row, snap } = record(name, file, prev, extra);
  rows.push(row);
  return snap;
}

// ── Part A：真实 agent 运行（两轮对话）—— 落盘由 assistant 触发 ──
const agentA = makeAgentDir();
process.env.PI_CODING_AGENT_DIR = agentA;
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";
const sessA = mkdtempSync(join(tmpdir(), "ucode-v1-sess-"));
const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("ucastest", "deepseek-v4-flash");
if (!model) { console.error("model-not-found"); process.exit(1); }

const partA: any[] = [];
const managerA = SessionManager.create(cwd, sessA);
const { session } = await createAgentSession({ model, modelRuntime, sessionManager: managerA } as any);
const fileA = session.sessionFile ?? managerA.getSessionFile()!;
let pa: Snap | null = null;
pa = runStep("A:created", fileA, pa, () => {}, partA);
await (async () => { await session.prompt("Reply with exactly one word: alpha"); })();
pa = runStep("A:prompt1", fileA, pa, () => {}, partA);
await (async () => { await session.prompt("Reply with exactly one word: beta"); })();
pa = runStep("A:prompt2", fileA, pa, () => {}, partA);

// ── Part B：在已落盘的真实会话上追加全部"修改类"entry 类型 ──
const partB: any[] = [];
let pb: Snap | null = pa;
let targetId = "";
pb = runStep("B:customMessage", fileA, pb, () => { targetId = managerA.appendCustomMessageEntry("spike", "hello spike", true); }, partB);
pb = runStep("B:sessionInfo", fileA, pb, () => { managerA.appendSessionInfo("spike session"); }, partB);
pb = runStep("B:customEntry", fileA, pb, () => { managerA.appendCustomEntry("spike-data", { n: 1 }); }, partB);
pb = runStep("B:modelChange", fileA, pb, () => { managerA.appendModelChange("ucastest", "deepseek-v4-flash"); }, partB);
pb = runStep("B:thinkingChange", fileA, pb, () => { managerA.appendThinkingLevelChange("medium"); }, partB);
pb = runStep("B:usage", fileA, pb, () => {
  managerA.appendUsage("cache_warm", "ucastest", "deepseek-v4-flash", {
    input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } as any);
}, partB);
pb = runStep("B:label", fileA, pb, () => { if (targetId) managerA.appendLabelChange(targetId, "checkpoint"); }, partB);
pb = runStep("B:contextEdit", fileA, pb, () => { if (targetId) managerA.appendContextEdit(targetId, { content: "replaced text" } as any); }, partB);
pb = runStep("B:compaction", fileA, pb, () => { if (targetId) managerA.appendCompaction("summary of spike", targetId, 1234); }, partB);
session.dispose();

// ── Part C（V-5）：旧版本 header 的文件，加载时是否被写回 ──
async function makeRealSession(): Promise<string> {
  const agentDir = makeAgentDir();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const rt = await ModelRuntime.create();
  const m = rt.getModel("ucastest", "deepseek-v4-flash")!;
  const sess = mkdtempSync(join(tmpdir(), "ucode-v5-sess-"));
  const mgr = SessionManager.create(cwd, sess);
  const { session: s } = await createAgentSession({ model: m, modelRuntime: rt, sessionManager: mgr } as any);
  await s.prompt("Reply with exactly one word: fixture");
  const f = s.sessionFile!;
  s.dispose();
  return f;
}

async function migrationTest(fromVersion: number) {
  const f = await makeRealSession();
  const before = readFileSync(f, "utf8");
  writeFileSync(f, before.replace(/"version":\s*3/, `"version": ${fromVersion}`));
  const snapBefore = snapshot(f);
  const rows: any[] = [];

  let openError: string | null = null;
  let opened: SessionManager | null = null;
  try { opened = SessionManager.open(f); } catch (e: any) { openError = String(e?.message ?? e); }
  const afterOpen = snapshot(f);
  rows.push({
    phase: "open", fromVersion, openError,
    rewrittenOnOpen: afterOpen.content !== snapBefore.content,
    prefixOk: isPrefixExtension(snapBefore.content, afterOpen.content),
    inodeSame: afterOpen.inode === snapBefore.inode,
    sizeBefore: snapBefore.size, sizeAfter: afterOpen.size,
    versionAfter: (afterOpen.content.match(/"version":\s*(\d+)/) ?? [])[1] ?? "?",
  });
  if (opened) {
    try {
      opened.appendSessionInfo("post-open append");
      const afterAppend = snapshot(f);
      rows.push({
        phase: "append",
        prefixOk: isPrefixExtension(afterOpen.content, afterAppend.content),
        inodeSame: afterAppend.inode === afterOpen.inode,
        sizeBefore: afterOpen.size, sizeAfter: afterAppend.size,
      });
    } catch (e: any) { rows.push({ phase: "append", error: String(e?.message ?? e) }); }
  }
  return { fromVersion, file: f, rows };
}

const v5: any[] = [];
try { v5.push(await migrationTest(2)); } catch (e: any) { v5.push({ fromVersion: 2, fatal: String(e?.message ?? e) }); }
try { v5.push(await migrationTest(1)); } catch (e: any) { v5.push({ fromVersion: 1, fatal: String(e?.message ?? e) }); }

writeFileSync(join(resultsDir, "v1.json"), JSON.stringify({ partA, partB }, null, 2));
writeFileSync(join(resultsDir, "v5.json"), JSON.stringify({ v5 }, null, 2));
console.log("\nwrote results/v1.json and results/v5.json");
