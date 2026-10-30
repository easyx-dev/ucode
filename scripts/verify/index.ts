/**
 * 约定校验入口：migrations / contracts / api-docs / plugin-docs / layers / tokens / design / themes /
 * appearance / brand / i18n / session-entries / manifest / hub-protocol / tests / ui-exports / changelog。
 *
 * 由根 `pnpm check` 调用（`biome check . && pnpm -r typecheck && pnpm -r test && tsx scripts/verify/index.ts`）。
 * 任一检查不通过即非零退出，输出处会用「文件:行」定位。
 * 改一处时用 `pnpm verify -- --only <项名>` 只跑相关的几项（全量仍在 1 秒级，收窄是为了少看无关输出）。
 */
import { resolve } from "node:path";

import { run as runBrand } from "../../packages/brand/scripts/verify.ts";
import { run as runApiDocs } from "./checks/api-docs.ts";
import { run as runAppearance } from "./checks/appearance.ts";
import { run as runChangelog } from "./checks/changelog.ts";
import { run as runContracts } from "./checks/contracts.ts";
import { run as runDesign } from "./checks/design.ts";
import { run as runHubProtocol } from "./checks/hub-protocol.ts";
import { run as runI18n } from "./checks/i18n.ts";
import { run as runLayers } from "./checks/layers.ts";
import { run as runManifest } from "./checks/manifest.ts";
import { run as runMigrations } from "./checks/migrations.ts";
import { run as runPluginDocs } from "./checks/plugin-docs.ts";
import { run as runSessionEntries } from "./checks/session-entries.ts";
import { run as runTests } from "./checks/tests.ts";
import { run as runThemes } from "./checks/themes.ts";
import { run as runTokens } from "./checks/tokens.ts";
import { run as runUiExports } from "./checks/ui-exports.ts";

const ROOT = resolve(import.meta.dirname, "../..");

const CHECKS: Array<{ name: string; run: (root: string) => string[] }> = [
  { name: "migrations", run: runMigrations },
  { name: "contracts", run: runContracts },
  { name: "api-docs", run: runApiDocs },
  { name: "plugin-docs", run: runPluginDocs },
  { name: "layers", run: runLayers },
  { name: "tokens", run: runTokens },
  { name: "design", run: runDesign },
  { name: "themes", run: runThemes },
  { name: "appearance", run: runAppearance },
  { name: "brand", run: runBrand },
  { name: "i18n", run: runI18n },
  { name: "session-entries", run: runSessionEntries },
  { name: "manifest", run: runManifest },
  { name: "hub-protocol", run: runHubProtocol },
  { name: "tests", run: runTests },
  { name: "ui-exports", run: runUiExports },
  { name: "changelog", run: runChangelog },
];

/** `pnpm verify -- --only changelog,i18n`：只跑指定项；缺省全跑 */
const selectedChecks = (): typeof CHECKS => {
  const index = process.argv.indexOf("--only");
  if (index < 0) return CHECKS;

  const available = CHECKS.map((check) => check.name).join(" / ");
  const names = (process.argv[index + 1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    console.error(`--only 后面要跟检查项名，可选：${available}`);
    process.exit(1);
  }

  const unknown = names.filter((name) => !CHECKS.some((check) => check.name === name));
  if (unknown.length > 0) {
    console.error(`未知的检查项 ${unknown.join(" / ")}，可选：${available}`);
    process.exit(1);
  }

  return CHECKS.filter((check) => names.includes(check.name));
};

const checks = selectedChecks();

let failures = 0;

for (const check of checks) {
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

console.log(`约定校验通过（${checks.length} 项）`);
