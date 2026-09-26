#!/usr/bin/env node
import { parseArgs } from "node:util";
import { envVar, getBrand } from "@ucode/branding";
import cliManifest from "../package.json" with { type: "json" };

const brand = getBrand();

/**
 * 步骤 0 的子命令面：命令名已定（impl §4.1），实现按同文档 §七 的步骤推进。
 * 文案一律从品牌配置派生，代码里不出现产品名与数据层目录名的字面量。
 */
const COMMANDS = [
  { name: "core start", summary: "启动核心层（步骤 2）" },
  { name: "web", summary: "启动内置 Web 壳（步骤 5）" },
  { name: "tui", summary: "启动内置 TUI 壳（步骤 5）" },
] as const;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

function usage(): string {
  const commands = COMMANDS.map((c) => `  ${c.name.padEnd(12)}${c.summary}`).join("\n");
  return [
    `${brand.productName} —— 分层智能体`,
    "",
    "用法：",
    `  ${brand.productName} <命令> [选项]`,
    "",
    "命令：",
    commands,
    "",
    "选项：",
    "  -h, --help      显示本帮助",
    "  -v, --version   显示版本",
    "",
    `数据层默认目录：~/${brand.dataDirName}`,
    `  可用 --data-dir 或环境变量 ${envVar("DATA_DIR")} 覆盖`,
    "",
  ].join("\n");
}

function fail(message: string, code: number): number {
  process.stderr.write(`${message}\n运行 ${brand.productName} --help 查看用法。\n`);
  return code;
}

export function main(argv: string[]): number {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 2);
  }

  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`${cliManifest.version}\n`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(usage());
    return 0;
  }

  const requested = positionals.slice(0, 2).join(" ");
  if (!COMMANDS.some((c) => c.name === requested)) {
    return fail(`未知命令：「${requested}」。`, 2);
  }

  process.stderr.write(`「${requested}」尚未实现：步骤 0 只交付工程脚手架。\n`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
