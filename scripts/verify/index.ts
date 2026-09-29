/**
 * 约定校验入口：migrations / contracts / tokens / brand。
 *
 * 由根 `pnpm check` 调用（`biome check . && pnpm -r typecheck && node scripts/verify/index.ts`）。
 * 任一检查不通过即非零退出，输出处会用「文件:行」定位。
 */
import { resolve } from "node:path";

import { run as runBrand } from "../../packages/brand/scripts/verify.ts";
import { run as runContracts } from "./checks/contracts.ts";
import { run as runMigrations } from "./checks/migrations.ts";
import { run as runTokens } from "./checks/tokens.ts";

const ROOT = resolve(import.meta.dirname, "../..");

const CHECKS: Array<{ name: string; run: (root: string) => string[] }> = [
  { name: "migrations", run: runMigrations },
  { name: "contracts", run: runContracts },
  { name: "tokens", run: runTokens },
  { name: "brand", run: runBrand },
];

let failures = 0;

for (const check of CHECKS) {
  const problems = check.run(ROOT);
  if (problems.length === 0) {
    console.log(`✓ ${check.name}`);
    continue;
  }

  failures += problems.length;
  console.error(`✗ ${check.name}（${problems.length} 处）`);
  for (const problem of problems) console.error(`    ${problem}`);
}

if (failures > 0) {
  console.error(`\n约定校验未通过：${failures} 处`);
  process.exit(1);
}

console.log(`约定校验通过（${CHECKS.length} 项）`);
