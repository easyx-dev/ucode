/**
 * 品牌串批量替换（应急工具）。
 *
 * 常规定制只改 `packages/brand/src/brand.ts`；当历史遗留、第三方文案或不在品牌包
 * 覆盖范围内的文件里残留了旧品牌串时，用它做一次批量矫正。
 *
 * 用法：
 *   node packages/brand/scripts/replace.ts --from <旧串> [--to <新串>] [--paths a,b] [--regex] [--with-scope] [--write]
 *
 * - `--to` 默认取当前 `brand.name`
 * - `--paths` 默认覆盖源码、文档与入口 HTML（相对仓库根，逗号分隔）
 * - `--regex` 让 `--from` 按正则解释，否则按字面量
 * - 默认跳过 npm scope（`@xxx/`）里的命中，避免改坏 `@ucode/contracts` 这类包名；连 scope 一起改用 `--with-scope`
 * - 默认只预演，加 `--write` 才落盘
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { brand } from "../src/brand.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".tmp"]);

const SCAN_FILE = /\.(?:ts|tsx|html|css|json|md|svg)$/;

/** 默认替换范围：品牌串可能出现、又不在品牌包覆盖内的文案与源码。
 *  有意不含 `packages/brand` 本身与 `packages/contracts`：品牌包靠改字面量，
 *  contracts 是接口契约，都不该被批量扫改。 */
const DEFAULT_TARGETS = [
  "apps/web/src",
  "apps/web/index.html",
  "apps/desktop/src",
  "apps/desktop/index.html",
  "server/src",
  "docs",
  "README.md",
];

type Options = {
  /** 待替换的旧串（`--regex` 时为正则源码） */
  from: string;
  /** 替换成的新串，默认取当前品牌名 */
  to: string;
  /** 替换范围，相对仓库根 */
  targets: string[];
  /** 是否按正则解释 `from` */
  regex: boolean;
  /** 是否连 npm scope（`@xxx/`）里的命中一起替换 */
  withScope: boolean;
  /** 是否落盘 */
  write: boolean;
};

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    from: "",
    to: brand.name,
    targets: DEFAULT_TARGETS,
    regex: false,
    withScope: false,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") options.from = argv[index + 1] ?? "";
    else if (arg === "--to") options.to = argv[index + 1] ?? "";
    else if (arg === "--paths") {
      options.targets = (argv[index + 1] ?? "").split(",").filter(Boolean);
    } else if (arg === "--regex") options.regex = true;
    else if (arg === "--with-scope") options.withScope = true;
    else if (arg === "--write") options.write = true;
  }
  return options;
};

/** 把字符串转成可安全放进正则的字面量 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 递归收集范围内的文本文件，返回绝对路径 */
const listFiles = (root: string, target: string): string[] => {
  const absolute = join(root, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (SCAN_FILE.test(entry.name)) files.push(join(dir, entry.name));
    }
  };
  walk(absolute);
  return files;
};

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.from === "") {
  console.error("缺少 --from：请给出待替换的旧品牌串");
  process.exit(1);
}

const pattern = new RegExp(
  `${options.withScope ? "" : "(?<!@)"}${options.regex ? `(?:${options.from})` : escapeRegExp(options.from)}`,
  "g",
);

/** 按 `from` 替换一次，返回新文本与命中次数 */
const apply = (text: string): { next: string; count: number } => {
  const count = text.match(pattern)?.length ?? 0;
  return { next: text.replace(pattern, options.to), count };
};

let changedFiles = 0;
let total = 0;
for (const target of options.targets) {
  for (const file of listFiles(root, target)) {
    const source = readFileSync(file, "utf8");
    const { next, count } = apply(source);
    if (count === 0) continue;

    changedFiles += 1;
    total += count;
    const shown = relative(root, file).split("\\").join("/");
    console.log(`${options.write ? "改写" : "命中"} ${shown}（${count} 处）`);
    if (options.write) writeFileSync(file, next, "utf8");
  }
}

if (total === 0) {
  console.log(`没有命中 "${options.from}"，无需替换`);
} else if (options.write) {
  console.log(`\n已写入 ${changedFiles} 个文件，共替换 ${total} 处`);
} else {
  console.log(`\n预演结束：${changedFiles} 个文件、共 ${total} 处；加 --write 落盘`);
}
