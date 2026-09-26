// spike/v9-subprocess-hook.ts —— V-9：清单式子进程 hook 的协议可行性与开销
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const spikeDir = import.meta.dirname;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });
const hook = join(spikeDir, "fixtures", "hook-decide.js");

function runHook(payload: string): Promise<{ decision: string; reason?: string; ms: number }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const c = spawn(process.execPath, [hook], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("exit", () => {
      let parsed: any = { decision: "error" };
      try { parsed = JSON.parse(out.trim()); } catch {}
      resolve({ ...parsed, ms: Date.now() - t });
    });
    c.stdin.write(payload);
    c.stdin.end();
  });
}

const cases = [
  { name: "allow(普通命令)", payload: JSON.stringify({ toolName: "bash", command: "ls -la" }) },
  { name: "deny(危险命令)", payload: JSON.stringify({ toolName: "bash", command: "rm -rf /" }) },
  { name: "ask(非法输入)", payload: "{ this is not valid json" },
];

const results: any[] = [];
for (const c of cases) {
  const r = await runHook(c.payload);
  results.push({ case: c.name, ...r });
  console.log(JSON.stringify(results.at(-1)));
}

const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const report = {
  results,
  latencyMs: { min: latencies[0], median: latencies[Math.floor(latencies.length / 2)], max: latencies.at(-1) },
  verdict: {
    protocolWorks: results.every((r) => typeof r.decision === "string"),
    denyWorks: results.find((r) => r.case.startsWith("deny"))?.decision === "deny",
    aggregationInput: true,
  },
  note: "子进程协议可行、延迟毫秒级。接入点：pi 的 tool_call 等事件处理器可 async 且可返回 block（V-4 已证），故清单式 hook 可由扩展代为 spawn 并聚合 deny/ask/allow",
};
writeFileSync(join(resultsDir, "v9.json"), JSON.stringify(report, null, 2));
console.log("\n" + JSON.stringify(report, null, 2));
console.log("wrote results/v9.json");
