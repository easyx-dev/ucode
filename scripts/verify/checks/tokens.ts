/**
 * 设计 token 守卫。
 *
 * 业务组件与原子组件都只允许使用语义 token（见 DESIGN.md）。这里拦两类写法：
 * 裸色值（hex、或后面直接跟数值的颜色函数）与 Tailwind 的调色板 utility（`bg-red-500`、`text-white`）。
 * 允许对语义变量做合成的写法（如 `color-mix(in oklch, var(--a), var(--b))`）——它不是裸色值。
 * CSS 由人维护，不在扫描范围。
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

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const files = ["apps/web/src", "packages/ui/src"].flatMap((dir) =>
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
      }
    }
  }

  return problems;
};
