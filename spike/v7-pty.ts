// spike/v7-pty.ts —— V-7：PTY 字节流通道（node-pty）
import * as pty from "node-pty";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const spikeDir = import.meta.dirname;
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const p = pty.spawn("/bin/zsh", ["-i"], { name: "xterm-color", cols: 80, rows: 24, cwd: spikeDir, env: process.env as Record<string, string> });
let out = "";
p.onData((d) => (out += d));

p.write("echo PTY_HELLO_$((1+1))\r");
await sleep(900);
const hello = /PTY_HELLO_2/.test(out);
const beforeResize = out.length;

p.resize(120, 40);
await sleep(200);
p.write("stty size\r");
await sleep(600);
const sizeOk = /40 120/.test(out);

// 信号：Ctrl-C 中断一个长命令
p.write("sleep 30\r");
await sleep(400);
p.write("\x03");
await sleep(400);
p.write("exit\r");
await sleep(300);

const report = {
  pty: { pid: p.pid, cols: p.cols, rows: p.rows },
  bytesBeforeResize: beforeResize,
  bytesTotal: out.length,
  signalSent: true,
  verdict: { byteStreamWorks: hello, resizeWorks: sizeOk, hasPidForSignal: p.pid > 0 },
  note: "PTY 在核心层所在主机；控制层是终端仿真器。承载到各绑定（含中继）需在绑定层定义",
};
try { p.kill(); } catch {}

writeFileSync(join(resultsDir, "v7.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nwrote results/v7.json");
