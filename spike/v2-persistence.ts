// spike/v2-persistence.ts —— V-2：pi 持久化能否被接管（A 基线 / B agent-dir / C session-dir / D 覆写 manager / E 内存）
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "./lib.ts";

const spikeDir = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), "ucode-v2-"));

function child(mode: string, env: Record<string, string>) {
  const clean: Record<string, string> = { ...process.env } as any;
  delete clean.PI_CODING_AGENT_DIR;
  delete clean.PI_CODING_AGENT_SESSION_DIR;
  const r = spawnSync(process.execPath, [join(spikeDir, "v2-child.ts")], {
    cwd: spikeDir,
    env: { ...clean, MODE: mode, SPIKE_CWD: spikeDir, ...env },
    encoding: "utf8",
    timeout: 180000,
  });
  const line = (r.stdout || "").trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return { mode, error: "child-failed", status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
}

const results: any = { provider: "ucastest/deepseek-v4-flash", experiments: [] };
const push = (x: any) => {
  results.experiments.push(x);
  console.log(
    `${x.mode}: sessionFile=${x.sessionFile ?? "(none)"} | agentDirJsonl=${x.jsonlUnderAgentDir?.length ?? "?"} | ` +
      `sessionDirJsonl=${x.jsonlUnderSessionDir?.length ?? "?"} | defaultDirJsonl=${x.jsonlUnderDefaultAgentDir?.length ?? "?"}` +
      (x.error ? ` ERROR=${x.error}` : ""),
  );
};

// 隔离 HOME，避免读到真实 ~/.pi
const isoHome = mkdtempSync(join(root, "iso-home-"));

// A 基线：HOME 覆写，无 PI_* 目录变量 → 默认 ~/.pi/agent
const homeA = mkdtempSync(join(root, "home-"));
writeConfig(join(homeA, ".pi", "agent"));
push(child("baseline", { HOME: homeA }));

// B：PI_CODING_AGENT_DIR
const agentB = join(root, "agent-b");
writeConfig(agentB);
push(child("agentdir", { HOME: isoHome, AGENT_DIR: agentB }));

// C：PI_CODING_AGENT_DIR + PI_CODING_AGENT_SESSION_DIR
const agentC = join(root, "agent-c");
const sessC = join(root, "sessions-c");
writeConfig(agentC);
mkdirSync(sessC, { recursive: true });
push(child("sessiondir-env", { HOME: isoHome, AGENT_DIR: agentC, SESSION_DIR: sessC, PI_CODING_AGENT_SESSION_DIR: sessC }));

// D：显式 SessionManager.create(cwd, sessionDir)
const agentD = join(root, "agent-d");
const sessD = join(root, "sessions-d");
writeConfig(agentD);
mkdirSync(sessD, { recursive: true });
push(child("sessiondir-manager", { HOME: isoHome, AGENT_DIR: agentD, SESSION_DIR: sessD }));

// E：SessionManager.inMemory()（不应落盘）
const agentE = join(root, "agent-e");
writeConfig(agentE);
push(child("inmemory", { HOME: isoHome, AGENT_DIR: agentE }));

mkdirSync(join(spikeDir, "results"), { recursive: true });
writeFileSync(join(spikeDir, "results", "v2.json"), JSON.stringify(results, null, 2));
console.log("\nwrote results/v2.json");
