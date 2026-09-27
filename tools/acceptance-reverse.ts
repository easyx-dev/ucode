/**
 * 反向验收（spec §7.3 的第 2 条必跑验收）：**只装壳时依赖树里不含 core**。
 *
 * 这是"核心层与控制层真的解耦"的独立证据——不是看源码里的 import，而是看**装出来的依赖树**：
 * 壳包把依赖声明错了（比如为了省事直接依赖 core），源码审查看不出来，装完就露馅。
 *
 *   node tools/acceptance-reverse.ts
 *
 * 只看被测包自己的 `dependencies` 子树：`pnpm list --json` 还会回显工作区根的
 * `unsavedDependencies`（根包的 devDependencies），把它算进来会得出假失败。
 */
import { spawnSync } from "node:child_process";

const SHELL_PACKAGES = ["@ucode/web", "@ucode/desktop", "@ucode/tui"];

/**
 * 壳不该在依赖树里看到的包：核心层与它的地基。
 * 注意**不含 bindings**——`sdk` 依赖四种绑定是设计如此（sdk 提供传输工厂子路径），
 * 壳经 sdk 拿到绑定不等于拿到了核心层。
 */
const FORBIDDEN = new Set(["@ucode/core", "@ucode/store", "@ucode/data-layer-spec"]);

type DependencyNode = { name?: string; dependencies?: Record<string, DependencyNode> };

/** 递归收集依赖树里的包名（只走 dependencies，不含 dev/optional/unsaved）。 */
function collectNames(node: DependencyNode, into: Set<string>): void {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    into.add(name);
    collectNames(child, into);
  }
}

function installedNames(shell: string): Set<string> {
  // `--prod`：只看这个包自己的生产依赖树。
  const result = spawnSync(
    "pnpm",
    ["--filter", shell, "list", "--depth", "Infinity", "--prod", "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`pnpm list 失败（${shell}）：${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as DependencyNode[];
  const names = new Set<string>();
  for (const project of parsed) {
    if (project.name !== shell) continue;
    collectNames(project, names);
  }
  return names;
}

function main(): void {
  const violations: { shell: string; forbidden: string }[] = [];
  for (const shell of SHELL_PACKAGES) {
    const names = installedNames(shell);
    for (const forbidden of FORBIDDEN) {
      if (names.has(forbidden)) violations.push({ shell, forbidden });
    }
  }

  if (violations.length > 0) {
    process.stderr.write("反向验收失败：壳的依赖树里出现了核心层侧包。\n");
    for (const violation of violations) {
      process.stderr.write(`  ${violation.shell} 依赖树里有 ${violation.forbidden}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `反向验收通过：${SHELL_PACKAGES.join("、")} 的依赖树里都没有 core/store/data-layer-spec。\n`,
  );
}

main();
