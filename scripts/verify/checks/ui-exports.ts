/**
 * `@ucode/ui` 公开面守卫：`exports` 是「外壳能用什么」的唯一声明处。
 *
 * 它的失效都很安静，所以在这里挡三道：
 * - 目标文件被改名 / 移动后没人用到那条子路径 → 死条目长期潜伏（被删掉的根入口 `.` 就是这样）；
 * - 通配后缀与目录实际内容漂移（`./business/*` 写死 `.tsx`，目录里却出现大量 `.ts`）→
 *   通配在传达一个不成立的事实，等有人真要引时才报错；
 * - 外壳里手写的、引不到的深链（`from "@ucode/ui/…"`）。
 *
 * 边界（`business/*` 对外的是组件，域内 `.ts` 是内部实现）见 docs/components.md「公开面」。
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join, posix } from "node:path";

import { listFiles } from "../files.ts";

/** 外壳目录：只有它们经包名引用 `@ucode/ui` */
const APP_DIRS = ["apps/web/src", "apps/desktop/src"];

/**
 * 通配后缀之外还允许出现在该目录的扩展名。
 * 业务域的公开面是组件（`.tsx`），域内的逻辑与 hook（`.ts`）是内部实现，不对外。
 */
const EXTRA_EXTENSIONS: Record<string, string[]> = {
  "./business/*": [".ts"],
};

type Exports = Record<string, string>;

/** `./base/*` → `{ prefix: "./base/", suffix: "" }`；无 `*` 返回 null */
const starOf = (key: string): { prefix: string; suffix: string } | null => {
  const index = key.indexOf("*");
  if (index < 0) return null;
  return { prefix: key.slice(0, index), suffix: key.slice(index + 1) };
};

/** 按 Node 的子路径模式解析 `@ucode/ui/<subpath>`；解析不到返回 null */
const resolveTarget = (exports: Exports, subpath: string): string | null => {
  const key = `./${subpath}`;
  if (exports[key]) return exports[key];

  for (const [pattern, target] of Object.entries(exports)) {
    const star = starOf(pattern);
    if (!star) continue;
    if (!key.startsWith(star.prefix) || !key.endsWith(star.suffix)) continue;
    const middle = key.slice(star.prefix.length, key.length - star.suffix.length);
    if (middle === "") continue;
    if (!target.includes("*")) continue;
    return target.replace("*", middle);
  }

  return null;
};

/** `./src/base/*.tsx` → 目录 `src/base` 与声明后缀 `.tsx` */
const wildcardOf = (target: string): { dir: string; extension: string } | null => {
  const index = target.indexOf("*");
  if (index < 0) return null;
  const before = target.slice(0, index);
  const after = target.slice(index + 1);
  // 通配前的部分以斜杠结尾（`./src/base/`），去掉斜杠才是目录；不结尾时退回取其父目录
  const dir = before.endsWith("/") ? before.slice(0, -1) : posix.dirname(before);
  return { dir, extension: after };
};

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const manifestPath = join(root, "packages/ui/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Exports;
    types?: string;
  };
  const exports = manifest.exports ?? {};

  for (const [key, target] of Object.entries(exports)) {
    const star = starOf(key);
    const wildcard = wildcardOf(target);

    if (!star) {
      if (wildcard) {
        problems.push(`packages/ui/package.json：exports["${key}"] 是具名条目，目标里不该有 *`);
        continue;
      }
      if (!existsSync(join(root, "packages/ui", target))) {
        problems.push(`packages/ui/package.json：exports["${key}"] 的目标不存在（${target}）`);
      }
      continue;
    }

    if (!wildcard) {
      problems.push(`packages/ui/package.json：exports["${key}"] 是通配条目，目标里必须有 *`);
      continue;
    }

    const dir = join(root, "packages/ui", wildcard.dir);
    if (!existsSync(dir)) {
      problems.push(
        `packages/ui/package.json：exports["${key}"] 的目标目录不存在（${wildcard.dir}）`,
      );
      continue;
    }

    const allowed = [wildcard.extension, ...(EXTRA_EXTENSIONS[key] ?? [])];
    const files = listFiles(root, `packages/ui/${wildcard.dir}`, () => true).filter(
      (path) => !path.includes("__tests__"),
    );

    const matched = files.filter((path) => path.endsWith(wildcard.extension));
    if (matched.length === 0) {
      problems.push(
        `packages/ui/package.json：exports["${key}"] 的 ${wildcard.extension} 在 ${wildcard.dir} 下一个都没有，这条通配是死条目`,
      );
    }

    for (const path of files) {
      const extension = extname(path);
      if (allowed.includes(extension)) continue;
      problems.push(
        `${path}：位于 exports["${key}"]（${wildcard.extension}）覆盖的目录下，但后缀是 ${extension}——` +
          "要么改后缀，要么登记进 ui-exports 的 EXTRA_EXTENSIONS（有意的内部实现），要么不要放进这个目录",
      );
    }
  }

  if (manifest.types && !existsSync(join(root, "packages/ui", manifest.types))) {
    problems.push(`packages/ui/package.json：types 指向的文件不存在（${manifest.types}）`);
  }

  for (const dir of APP_DIRS) {
    for (const path of listFiles(root, dir, (absolutePath) => /\.(tsx?|css)$/.test(absolutePath))) {
      const source = readFileSync(join(root, path), "utf8");
      const lines = source.split("\n");

      for (const [index, line] of lines.entries()) {
        // 三种写法都要盖：`from "…"`、副作用导入 `import "…"`、动态 `import("…")`，
        // CSS 里的 `@import "…"` 也一并看
        if (!/(?:from|@import)\s+["']|^\s*import\s+["']|import\s*\(\s*["']/.test(line)) continue;
        for (const match of line.matchAll(/["'](@ucode\/ui\/[^"']+)["']/g)) {
          const subpath = match[1].slice("@ucode/ui/".length);
          const target = resolveTarget(exports, subpath);
          if (!target) {
            problems.push(
              `${path}:${index + 1}：引用了 exports 未声明的子路径（@ucode/ui/${subpath}）`,
            );
            continue;
          }
          if (!existsSync(join(root, "packages/ui", target))) {
            problems.push(
              `${path}:${index + 1}：@ucode/ui/${subpath} 解析到的文件不存在（${target}）`,
            );
          }
        }
      }
    }
  }

  return problems;
};
