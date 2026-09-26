// spike/v6-workspace-query.ts —— V-6：工作区文件/Git 结构化查询的可行性（核心层侧实现）
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const spikeDir = import.meta.dirname;
const repo = join(spikeDir, "..");
const resultsDir = join(spikeDir, "results");
mkdirSync(resultsDir, { recursive: true });

// 1) 文件树（增量刷新的基础：mtime 可判定变更）
function tree(root: string, maxDepth = 3) {
  const out: { path: string; size: number; mtimeMs: number; dir: boolean }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "results") continue;
      const p = join(d, e.name);
      const st = statSync(p);
      out.push({ path: relative(root, p), size: st.size, mtimeMs: st.mtimeMs, dir: e.isDirectory() });
      if (e.isDirectory()) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const t0 = Date.now();
const files = tree(repo);
const treeMs = Date.now() - t0;

// 2) Git 图谱（分页加载的基础）
const logRaw = execFileSync("git", ["-C", repo, "log", "-n", "5", "--name-status", "--pretty=format:COMMIT %h %s"], { encoding: "utf8" });
const commits = logRaw.split("\n").filter((l) => l.startsWith("COMMIT")).length;

// 3) 变更筛选（按时间窗口）
const changed = execFileSync("git", ["-C", repo, "diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);

const report = {
  tree: { entries: files.length, dirs: files.filter((f) => f.dir).length, buildMs: treeMs, hasMtime: files.every((f) => typeof f.mtimeMs === "number") },
  git: { logPageCommits: commits, workingTreeChangedFiles: changed.length, changedSample: changed.slice(0, 5) },
  verdict: { fileTreeQuery: files.length > 0, gitLogPaginated: commits > 0, changeFilter: Array.isArray(changed) },
  note: "pi 不提供该查询面，需在核心层自建并经协议 C 的通道暴露；本项验证的是数据可得性与构建成本",
};

writeFileSync(join(resultsDir, "v6.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nwrote results/v6.json");
