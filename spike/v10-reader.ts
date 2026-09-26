// spike/v10-reader.ts —— V-10 跟随方：fs.watch（无常）(watch 事件可合并/丢失)「+轮询兜底」跟踪追加
import { spawn } from "node:child_process";
import { watch, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const spikeDir = import.meta.dirname;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });

const N = Number(process.env.V10_APPENDS ?? "20");

const child = spawn(process.execPath, [join(spikeDir, "v10-writer.ts")], {
  cwd: spikeDir,
  env: { ...process.env, V10_APPENDS: String(N) },
  stdio: ["ignore", "pipe", "inherit"],
});

let file: string | null = null;
let watchEvents = 0;
let pollChanges = 0;
let lastContent = "";
let prefixOk = true;
let maxLines = 0;
let watcher: ReturnType<typeof watch> | null = null;

function countLines(s: string): number {
  const idx = s.lastIndexOf("\n");
  if (idx < 0) return 0;
  return s.slice(0, idx).split("\n").length;
}

function readNow(src: "watch" | "poll") {
  if (!file || !existsSync(file)) return;
  const s = readFileSync(file, "utf8");
  if (s === lastContent) return;
  if (lastContent && !s.startsWith(lastContent)) prefixOk = false;
  lastContent = s;
  const n = countLines(s);
  if (n > maxLines) maxLines = n;
  if (src === "watch") watchEvents++;
  else pollChanges++;
}

const poll = setInterval(() => readNow("poll"), 30);

child.stdout.on("data", (buf: Buffer) => {
  for (const line of buf.toString("utf8").split("\n")) {
    if (line.startsWith("FILE ")) {
      file = line.slice(5).trim();
      console.log(`reader watching ${file}`);
      watcher = watch(file, () => readNow("watch"));
    }
  }
});

child.on("exit", () => {
  if (watcher) watcher.close();
  clearInterval(poll);
  readNow("poll"); // 收尾再读一次

  const expected = maxLines; // 观测到的最大行数
  const report = {
    appends: N,
    watchEvents,
    pollChanges,
    maxLinesObserved: maxLines,
    prefixOk,
    watchAloneWouldMissFinalState: watchEvents === 0,
    note: "watchEvents 小于 appends 说明 fs.watch 合并/丢弃了事件，轮询兜底保证最终一致",
  };
  writeFileSync(join(resultsDir, "v10.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("\nwrote results/v10.json");
});
