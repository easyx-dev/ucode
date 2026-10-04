/**
 * 品牌守卫。
 *
 * 三条约束（见 README「品牌定制」）：
 * 1. 品牌值合法：name / title 非空，slug 只含小写字母、数字与连字符；
 * 2. 图片引用有效：`src/assets.ts` 里 import 的资源都存在且非空（扩展名不限）；
 * 3. 源码不留硬编码品牌名：业务代码一律从 `@ucode/brand` 取值，
 *    只有 npm scope（如 `@ucode/contracts`）这类构建期标识可以出现品牌串。
 *
 * 由 `scripts/verify/index.ts` 注册，随根 `pnpm check` 执行。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { brand } from "../src/brand.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".tmp"]);

/** 扫描范围：会渲染品牌名或引用品牌资源的源码、入口 HTML 与构建插件 */
const SCAN_TARGETS = [
  "apps/web/src",
  "apps/web/plugins",
  "apps/web/index.html",
  "packages/ui/src",
  "server/src",
];

const SCAN_FILE = /\.(?:ts|tsx|html)$/;

/** 声明图片 import 的模块，资源齐备与否以它为准 */
const ASSETS_MODULE = "packages/brand/src/assets.ts";

const normalize = (path: string): string => path.split("\\").join("/");

/** 递归收集目标（文件或目录）下的待检文件，返回仓库相对路径 */
const listTargetFiles = (root: string, target: string): string[] => {
  const absolute = join(root, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [normalize(relative(root, absolute))];

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (SCAN_FILE.test(entry.name)) files.push(normalize(relative(root, join(dir, entry.name))));
    }
  };
  walk(absolute);
  return files;
};

/** `src/assets.ts` 里所有相对 import 的绝对路径 */
const referencedAssets = (root: string): string[] => {
  const modulePath = join(root, ASSETS_MODULE);
  if (!existsSync(modulePath)) return [];
  const source = readFileSync(modulePath, "utf8");
  const references: string[] = [];
  for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const specifier = match[1];
    if (specifier) references.push(resolve(join(root, "packages/brand/src"), specifier));
  }
  return references;
};

/** npm scope 是构建期标识，命中品牌串也不算硬编码 */
const SCOPED_IMPORT = /@[A-Za-z0-9._-]+\//g;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 校验品牌值、资源与硬编码，返回问题清单（空数组表示通过） */
export const run = (root: string): string[] => {
  const problems: string[] = [];

  if (brand.name.trim() === "") {
    problems.push("packages/brand/src/brand.ts：brand.name 不能为空");
  }
  if (brand.title.trim() === "") {
    problems.push("packages/brand/src/brand.ts：brand.title 不能为空");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brand.slug)) {
    problems.push(
      `packages/brand/src/brand.ts：brand.slug "${brand.slug}" 只能包含小写字母、数字与连字符`,
    );
  }

  const references = referencedAssets(root);
  if (references.length === 0) {
    problems.push(`${ASSETS_MODULE}：没有解析到任何图片引用`);
  }
  for (const path of references) {
    if (!existsSync(path)) {
      problems.push(`${ASSETS_MODULE}：引用的资源不存在（${normalize(relative(root, path))}）`);
    } else if (statSync(path).size === 0) {
      problems.push(`${normalize(relative(root, path))}：文件为空`);
    }
  }

  // 只匹配当前品牌名：能拦住「新增硬编码」，但拦不住改名后残留的旧名（后者靠 replace 脚本）。
  // 因此品牌名不宜取常见子串（如 "code"），否则会误报。
  const hardcoded = new RegExp(escapeRegExp(brand.name), "i");
  for (const target of SCAN_TARGETS) {
    for (const file of listTargetFiles(root, target)) {
      const lines = readFileSync(join(root, file), "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (hardcoded.test(line.replace(SCOPED_IMPORT, ""))) {
          problems.push(
            `${file}:${index + 1}：出现硬编码品牌名，请改用 @ucode/brand 的 brand.name`,
          );
        }
      }
    }
  }

  return problems;
};
