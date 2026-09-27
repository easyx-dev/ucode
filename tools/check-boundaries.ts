#!/usr/bin/env node
/**
 * 依赖边界门禁。
 *
 * 规则来源是允许列表（tools/boundaries.json），不是禁止列表——新增包、新增依赖
 * 都必须显式登记，否则直接报错。对应 docs/archive/01-架构.md §7.2 与 §7.3。
 *
 * 用 Oxc 的解析器取导入说明符（静态 import / 再导出 / 动态 import 的字面量）：
 * 它与 TypeScript 编译器解耦——TS 7 尚未发布 JS API，编译器 API 类工具（dependency-cruiser、
 * typescript-eslint 系）因此不可用。
 *
 * 检查项：
 *  1. 工作区内部导入必须落在该包的允许列表内；
 *  2. 声明了的工作区依赖也必须在允许列表内（防止"先声明、后导入"绕过）；
 *  3. 每个工作区包必须在允许列表里登记（漏登记的包直接失败）；
 *  4. 导入的工作区包必须已在 package.json 声明（防止未声明的隐式依赖）；
 *  5. 相对导入不得逃出本包目录；
 *  6. 外部依赖必须已在 package.json 声明；
 *  7. 无法静态解析的动态导入必须显式登记豁免；
 *  8. 反向验收：forbiddenTransitive 列出的传递依赖不得出现（如只装壳时不得含服务层）。
 *
 * 用法：node tools/check-boundaries.ts [--root <目录>]（--root 供门禁自测用）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { parseSync } from "oxc-parser";

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type Policy = {
  allowList: Record<string, string[]>;
  forbiddenTransitive: Record<string, string[]>;
  alwaysAllowedExternals: string[];
  allowComputedDynamicImports: string[];
};

type WorkspacePackage = {
  name: string;
  dir: string;
  declared: Set<string>;
};

type Violation = { file: string; line: number; message: string };

const ROOT = resolveRoot(process.argv.slice(2));
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

function resolveRoot(argv: string[]): string {
  const index = argv.indexOf("--root");
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined ? resolve(import.meta.dirname, "..") : resolve(value);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function discoverPackages(): WorkspacePackage[] {
  const dirs: string[] = [];
  for (const group of ["packages", "packages/bindings", "apps"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const dir = join(base, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, "package.json"))) dirs.push(dir);
    }
  }
  if (existsSync(join(ROOT, "hub", "package.json"))) dirs.push(join(ROOT, "hub"));

  return dirs.map((dir) => {
    const manifest = readJson<Manifest>(join(dir, "package.json"));
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    return { name: manifest.name, dir, declared };
  });
}

function walkSource(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSource(join(dir, entry.name), out);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(join(dir, entry.name));
  }
  return out;
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}

type Specifier = { value: string; line: number; computed: boolean };

function collectSpecifiers(file: string, code: string, violations: Violation[]): Specifier[] {
  const parsed = parseSync(file, code);
  for (const error of parsed.errors) {
    const label = (error.labels ?? [])[0];
    violations.push({
      file: relative(ROOT, file),
      line: lineOf(code, label?.start ?? 0),
      message: `解析失败：${error.message}`,
    });
  }

  const found: Specifier[] = [];
  for (const imp of parsed.module?.staticImports ?? []) {
    found.push({
      value: imp.moduleRequest.value,
      line: lineOf(code, imp.moduleRequest.start),
      computed: false,
    });
  }
  for (const dyn of parsed.module?.dynamicImports ?? []) {
    const raw = code.slice(dyn.moduleRequest.start, dyn.moduleRequest.end);
    const literal = /^(["'])(.*)\1$/.exec(raw);
    found.push({
      value: literal?.[2] ?? raw,
      line: lineOf(code, dyn.moduleRequest.start),
      computed: literal === null,
    });
  }
  return found;
}

function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return builtinModules.includes(specifier);
}

function closure(start: string, byName: Map<string, WorkspacePackage>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const pkg = byName.get(current);
    if (pkg === undefined) continue;
    for (const dep of pkg.declared) {
      if (!byName.has(dep) || seen.has(dep) || dep === start) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  return seen;
}

function main(): number {
  const policy = readJson<Policy>(join(ROOT, "tools", "boundaries.json"));
  const packages = discoverPackages();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const violations: Violation[] = [];

  for (const pkg of packages) {
    const allowed = policy.allowList[pkg.name];
    if (allowed === undefined) {
      violations.push({
        file: relative(ROOT, join(pkg.dir, "package.json")),
        line: 1,
        message: "工作区包未在 tools/boundaries.json 的允许列表里登记（新增包必须显式登记）",
      });
      continue;
    }
    const allowedSet = new Set(allowed);

    for (const dep of pkg.declared) {
      if (byName.has(dep) && !allowedSet.has(dep)) {
        violations.push({
          file: relative(ROOT, join(pkg.dir, "package.json")),
          line: 1,
          message: `声明了禁止的内部依赖：${dep}`,
        });
      }
    }

    for (const file of walkSource(join(pkg.dir, "src"))) {
      const rel = relative(ROOT, file);
      const code = readFileSync(file, "utf8");
      for (const spec of collectSpecifiers(file, code, violations)) {
        if (spec.computed) {
          if (!policy.allowComputedDynamicImports.includes(rel)) {
            violations.push({
              file: rel,
              line: spec.line,
              message: `动态导入的说明符无法静态校验：${spec.value}`,
            });
          }
          continue;
        }
        if (isRelative(spec.value)) {
          const target = resolve(join(file, ".."), spec.value);
          if (!target.startsWith(pkg.dir + sep)) {
            violations.push({
              file: rel,
              line: spec.line,
              message: `相对导入逃出本包目录：${spec.value}`,
            });
          }
          continue;
        }
        if (isBuiltin(spec.value)) continue;

        const target = packageOf(spec.value);
        if (byName.has(target)) {
          if (!allowedSet.has(target)) {
            violations.push({
              file: rel,
              line: spec.line,
              message: `导入了不在允许列表内的内部包：${target}`,
            });
          }
          if (!pkg.declared.has(target)) {
            violations.push({
              file: rel,
              line: spec.line,
              message: `导入了未在 package.json 声明的内部包：${target}`,
            });
          }
          continue;
        }

        if (pkg.declared.has(target) || policy.alwaysAllowedExternals.includes(target)) continue;
        violations.push({
          file: rel,
          line: spec.line,
          message: `导入了未在 package.json 声明的外部依赖：${target}`,
        });
      }
    }
  }

  for (const [name, forbidden] of Object.entries(policy.forbiddenTransitive)) {
    const pkg = byName.get(name);
    if (pkg === undefined) continue;
    const reachable = closure(name, byName);
    for (const target of forbidden) {
      if (reachable.has(target)) {
        violations.push({
          file: relative(ROOT, join(pkg.dir, "package.json")),
          line: 1,
          message: `传递依赖里出现了禁止的包：${name} → ${target}`,
        });
      }
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`依赖边界门禁通过：${packages.length} 个包，0 违规。\n`);
    return 0;
  }

  process.stderr.write("依赖边界门禁失败：\n\n");
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line}  ${v.message}\n`);
  }
  process.stderr.write(
    `\n共 ${violations.length} 处违规。允许列表见 tools/boundaries.json；依据见 docs/archive/01-架构.md §7.2。\n`,
  );
  return 1;
}

process.exitCode = main();
