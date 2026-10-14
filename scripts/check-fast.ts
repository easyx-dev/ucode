/**
 * 中途收窄的校验入口（约定见 AGENTS.md「验证命令」）。
 *
 * 全量 `pnpm check` 的耗时几乎全在测试（实测 11s，占一半）与全仓 typecheck（9s）；「刚改完一批文件、
 * 先看有没有低级错误」不需要它们。这里只做三件便宜的事：工作区改动文件的 biome 检查、全部包 typecheck、
 * 约定校验。测试与构建仍由收尾的全量 `pnpm check` 兜。
 *
 * 不用 `biome check --changed`：那个比的是**已提交**的改动（同 `--since` 给的提交点），
 * 工作区里改了还没提交的文件它一个都看不到——而中途要检查的正是这些。
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** biome 认的扩展名；其余改动（图片、二进制、锁文件之外的产物）不参与检查 */
const LINTABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|jsonc|css|md)$/;

const git = (args: string[]): string => {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.stderr.trim()}`);
  return result.stdout;
};

/** `git status --porcelain -z` 的每条记录是 `XY <path>`；删除的文件没有可检查的内容 */
const changedFiles = (): string[] =>
  git(["status", "--porcelain", "-z", "--no-renames"])
    .split("\0")
    .filter((record) => record.length > 3 && !record.slice(0, 2).includes("D"))
    .map((record) => record.slice(3))
    .filter((path) => LINTABLE.test(path));

/** pnpm 在 Windows 上是 `pnpm.cmd`；不走 shell，免得路径里的空格与中文被二次解析 */
const run = (args: string[]): number =>
  spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: ROOT,
    stdio: "inherit",
  }).status ?? 1;

const files = changedFiles();

if (files.length === 0) {
  console.log("工作区没有可检查的改动文件，跳过 biome");
} else {
  console.log(`biome：检查工作区改动的 ${files.length} 个文件`);
  if (run(["exec", "biome", "check", ...files]) !== 0) process.exit(1);
}

if (run(["-r", "typecheck"]) !== 0) process.exit(1);
if (run(["verify"]) !== 0) process.exit(1);

console.log("\n中途校验通过（测试与构建留给收尾的 `pnpm check`）");
