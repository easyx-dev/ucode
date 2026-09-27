#!/usr/bin/env node
/**
 * 品牌字面量门禁。
 *
 * 架构依据：ADR-023（品牌与产品标识参数化）。产品名、数据层目录名、appId、厂商名、
 * URL scheme 一律从品牌配置读取，代码里不得出现字面量——否则 B 端换一份品牌配置
 * 重新构建时，这些字面量就是漏改的硬编码。
 *
 * 范围：本仓第一方源码（.ts/.tsx/.mjs/.cjs/.js），排除品牌配置自身、依赖与产物。
 * 例外：以 @ 开头的包 scope 标识（如 @ucode/protocol）属编译期标识，机械替换即可，不算违规。
 *
 * 用法：node tools/check-brand-literals.ts [--root <目录>]（--root 供门禁自测用）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getBrand } from "@ucode/branding";

type Violation = { file: string; line: number; value: string };

const ROOT = resolveRoot(process.argv.slice(2));
const SCAN_ROOTS = ["packages", "packages/bindings", "apps", "hub", "tools", "tests"];
const ROOT_FILES = ["vitest.config.ts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".cjs", ".js"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-renderer",
  "core-bundle",
  "release",
  "coverage",
  ".git",
  "assets",
]);

const brand = getBrand();
const forbidden = [
  brand.productName,
  brand.dataDirName,
  brand.appId,
  brand.vendor,
  brand.urlScheme,
];

function resolveRoot(argv: string[]): string {
  const index = argv.indexOf("--root");
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined ? resolve(import.meta.dirname, "..") : resolve(value);
}

function filesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) filesUnder(join(dir, entry.name), out);
      continue;
    }
    if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(join(dir, entry.name));
  }
  return out;
}

/** 去掉 @ 开头的 scope 标识后再匹配，避免把 @ucode/xxx 这类包名误判为品牌字面量。 */
function stripScopes(code: string): string {
  return code.replace(/@[A-Za-z0-9._-]*/g, (match) => " ".repeat(match.length));
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}

function main(): number {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) filesUnder(join(ROOT, root), files);
  for (const file of ROOT_FILES) {
    const path = join(ROOT, file);
    if (existsSync(path)) files.push(path);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    const stripped = stripScopes(readFileSync(file, "utf8"));

    // 同一个位置可能命中多个品牌值（如 appId 里含有产品名），只报最长的那一个，报错才具体。
    const matches: { index: number; value: string }[] = [];
    for (const value of forbidden) {
      let index = stripped.indexOf(value);
      while (index !== -1) {
        matches.push({ index, value });
        index = stripped.indexOf(value, index + value.length);
      }
    }
    const precise = matches.filter(
      (candidate) =>
        !matches.some(
          (other) =>
            other.value.length > candidate.value.length &&
            other.index <= candidate.index &&
            other.index + other.value.length >= candidate.index + candidate.value.length,
        ),
    );

    const byIndex = new Map<number, string>();
    for (const match of precise) {
      const current = byIndex.get(match.index);
      if (current === undefined || current.length < match.value.length) {
        byIndex.set(match.index, match.value);
      }
    }
    for (const [index, value] of byIndex) {
      violations.push({ file: relative(ROOT, file), line: lineOf(stripped, index), value });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`品牌字面量门禁通过：扫描 ${files.length} 个文件，0 违规。\n`);
    return 0;
  }

  process.stderr.write("品牌字面量门禁失败：源码里出现了品牌配置的字面量。\n\n");
  for (const v of violations) {
    process.stderr.write(
      `  ${v.file}:${v.line}  字面量「${v.value}」应改为从 @ucode/branding 读取\n`,
    );
  }
  process.stderr.write(
    `\n共 ${violations.length} 处。品牌配置见 packages/branding/brand.json；依据见 ADR-023。\n`,
  );
  return 1;
}

process.exitCode = main();
