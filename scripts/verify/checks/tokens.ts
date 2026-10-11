/**
 * 设计 token 守卫。
 *
 * 拦三类写法：
 * 1. 裸色值（hex、或后面直接跟数值的颜色函数）与 Tailwind 调色板 utility（`bg-red-500`、`text-white`）；
 * 2. 组件里直接引用调色板变量（`var(--color-neutral-900)`）——调色板只属于 token 定义层；
 * 3. token 定义层里的语义值写成字面色：只能是 `var()` / `color-mix()` / `calc()`。
 *
 * 允许对语义变量做合成的写法（如 `color-mix(in oklab, var(--a), var(--b))`）——它不是裸色值。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.%]/;

const PALETTE =
  "white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const PALETTE_UTILITY = new RegExp(
  `(?:^|[\\s"'\`(])(?:bg|text|border|ring|divide|outline|fill|stroke|from|to|via|shadow|decoration|accent|caret|placeholder)-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d{1,3})?`,
);

/** 组件里直接引用调色板变量：调色板只属于 token 定义层 */
const PALETTE_VAR = new RegExp(`var\\(--color-(?:${PALETTE})-\\d+\\)`);

/** token 定义层：允许写值、且要求值必须是引用或合成的文件 */
const TOKEN_FILES = ["packages/ui/src/styles/tokens.css"];
const THEMES_DIR = "packages/ui/src/styles/themes";

/** 由映射层（`--color-*: var(--x)`）反查出语义颜色变量名 */
const colorVarsOf = (css: string): Set<string> => {
  const names = new Set<string>();
  for (const match of css.matchAll(/--color-[a-z0-9-]+:\s*var\((--[a-z0-9-]+)\)/g)) {
    names.add(match[1]);
  }
  return names;
};

/**
 * token 定义层不允许出现字面色值：语义颜色只能引用调色板变量或做 `color-mix` 合成。
 * 参数类变量（字号基准、密度、圆角、时长）不是颜色，不在此列。
 */
const checkTokenLiterals = (root: string, problems: string[]): void => {
  const files = [...TOKEN_FILES, ...listFiles(root, THEMES_DIR, (path) => path.endsWith(".css"))];

  for (const file of files) {
    const css = readFileSync(join(root, file), "utf8");
    const colorVars = colorVarsOf(css);
    const isThemeFile = file.startsWith(THEMES_DIR);

    for (const [index, line] of css.split("\n").entries()) {
      const declaration = line.match(/^\s*(--[a-z0-9-]+):\s*(.+?);/);
      if (!declaration) continue;
      const [, name, value] = declaration;
      const isColor =
        isThemeFile || colorVars.has(name) || /^--(?:theme|code|shadow|elevation)-/.test(name);
      if (!isColor) continue;
      // 先摘掉 var() 引用，再看剩下的部分有没有字面色
      if (RAW_COLOR.test(value.replace(/var\([^)]*\)/g, ""))) {
        problems.push(
          `${file}:${index + 1}：${name} 写了字面色值，语义层只能用 var() / color-mix() / calc()`,
        );
      }
    }
  }
};

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const files = ["apps/web/src", "apps/desktop/src/renderer", "packages/ui/src"].flatMap((dir) =>
    listFiles(root, dir, (path) => /\.tsx?$/.test(path)),
  );

  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (RAW_COLOR.test(line)) {
        problems.push(`${file}:${index + 1}：禁止裸色值，请改用语义 token`);
        continue;
      }
      if (PALETTE_UTILITY.test(line)) {
        problems.push(`${file}:${index + 1}：禁止非语义颜色 utility，请改用语义 token`);
        continue;
      }
      if (PALETTE_VAR.test(line)) {
        problems.push(`${file}:${index + 1}：组件里不要直接引用调色板变量，请改用语义 token`);
      }
    }
  }

  checkTokenLiterals(root, problems);

  return problems;
};
