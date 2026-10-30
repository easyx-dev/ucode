/**
 * 测试脚本守卫。
 *
 * 根 `pnpm test` 走 `pnpm -r test`，只跑**声明了 `test` 脚本**的包，没有脚本的包会被静默跳过——
 * 于是「在 `__tests__/` 里放了用例却忘记补脚本」时 `pnpm check` 依然全绿，用例根本不执行。
 * 这里把它变成显式失败：有 `__tests__` 就必须有 `test` 脚本。
 * 约定见 AGENTS.md「验证命令」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";
import { workspaceDirs } from "../workspace.ts";

export const run = (root: string): string[] => {
  const problems: string[] = [];

  for (const dir of workspaceDirs(root)) {
    const cases = listFiles(root, `${dir}/src`, (path) => path.endsWith(".test.ts"));
    if (cases.length === 0) continue;

    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (!manifest.scripts?.test) {
      problems.push(
        `${dir}/package.json：有 ${cases.length} 个测试用例但没有 test 脚本，pnpm -r test 会跳过整个包`,
      );
    }
  }

  return problems;
};
