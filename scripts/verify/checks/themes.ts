/**
 * 配色主题守卫（见 DESIGN.md「配色主题」）。
 *
 * 主题只允许覆盖主题层（`--theme-*`），且必须给出浅色与深色两块：
 * 漏掉深色块会被 `.dark` 的基础主题层盖过去，表现为「切了主题但深色下没变」——
 * 这类问题在界面上不报错，只能靠校验拦。
 *
 * 1. 每份 `styles/themes/*.css` 里的每个主题，浅色块与 `html.dark[data-theme]` 块都必须存在；
 * 2. 两块都要覆盖 `tokens.css` 基础 `:root` 里声明的全部 `--theme-*` 变量；
 * 3. `lib/themes.ts` 的主题清单与 CSS 里的 `data-theme` 取值一一对应。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COLOR_THEME_IDS } from "../../../packages/ui/src/lib/themes.ts";
import { listFiles } from "../files.ts";

const TOKENS = "packages/ui/src/styles/tokens.css";
const THEMES_DIR = "packages/ui/src/styles/themes";

/**
 * 主题必须覆盖的配色变量：漏掉任何一个都会让「切了主题」在某处露回默认配色。
 * 强度类变量（text-soft / text-faint / line-soft / overlay / shadow-*）不在其中：
 * 它们是配方参数而非配色，默认值由基础主题层提供，主题想改再覆写。
 */
const REQUIRED_THEME_VARS = [
  "--theme-shell",
  "--theme-panel",
  "--theme-raised",
  "--theme-solid",
  "--theme-text",
  "--theme-primary",
  "--theme-primary-fg",
  "--theme-ring",
  "--theme-line",
];

/** 抽出某个块里声明的 `--theme-*` 变量名 */
const themeVarsIn = (block: string): Set<string> =>
  new Set(block.match(/--theme-[a-z-]+(?=\s*:)/g) ?? []);

/** 把选择器块切出来：逐行扫描，含 `{` 的行即选择器行（注释行不含花括号） */
const splitBlocks = (css: string): Array<{ selector: string; body: string }> => {
  const blocks: Array<{ selector: string; body: string }> = [];
  let selector: string | null = null;
  let body = "";

  for (const line of css.split("\n")) {
    if (selector === null) {
      const open = line.indexOf("{");
      if (open === -1) continue;
      selector = line.slice(0, open).trim();
      body = line.slice(open + 1);
    } else {
      body += `\n${line}`;
    }
    if (!body.includes("}")) continue;
    blocks.push({ selector, body: body.slice(0, body.indexOf("}")) });
    selector = null;
    body = "";
  }

  return blocks;
};

export const run = (root: string): string[] => {
  const problems: string[] = [];

  // 基础主题层（浅色）声明的变量集合：主题必须覆盖它
  const tokensCss = readFileSync(join(root, TOKENS), "utf8");
  const baseBlock = splitBlocks(tokensCss).find((block) => block.selector === ":root");
  const declared = themeVarsIn(baseBlock?.body ?? "");
  if (declared.size === 0) {
    problems.push(`${TOKENS}：没有找到基础主题层（:root 里的 --theme-* 变量）`);
    return problems;
  }
  for (const name of REQUIRED_THEME_VARS) {
    if (!declared.has(name)) problems.push(`${TOKENS}：基础主题层缺少 ${name}`);
  }

  const declaredThemes = new Map<string, string>();
  const files = listFiles(root, THEMES_DIR, (path) => path.endsWith(".css"));

  for (const file of files) {
    const css = readFileSync(join(root, file), "utf8");
    const blocks = splitBlocks(css);
    /** 本文件声明的主题：成对性只看本文件，否则新增第二个主题文件时会对前一个重复报错 */
    const idsInFile = new Set<string>();

    for (const block of blocks) {
      const match = block.selector.match(/^html(\.dark)?\[data-theme="([^"]+)"\]$/);
      if (!match) {
        problems.push(
          `${file}：主题选择器只能是 html[data-theme="…"] 或 html.dark[data-theme="…"]`,
        );
        continue;
      }
      const [, dark, id] = match;
      idsInFile.add(id);
      const seenIn = declaredThemes.get(id);
      if (seenIn && seenIn !== file) {
        problems.push(`${file}：主题 ${id} 已在 ${seenIn} 定义过`);
      }
      declaredThemes.set(id, file);

      const vars = themeVarsIn(block.body);
      const missing = REQUIRED_THEME_VARS.filter((name) => !vars.has(name));
      if (missing.length > 0) {
        problems.push(
          `${file}：主题 ${id} ${dark ? "深色" : "浅色"}块缺少 ${missing.join("、")}（缺项会被默认主题盖住）`,
        );
      }
      const unknown = [...vars].filter((name) => !declared.has(name));
      if (unknown.length > 0) {
        problems.push(`${file}：主题 ${id} 覆盖了主题层以外的变量 ${unknown.join("、")}`);
      }
    }

    for (const id of idsInFile) {
      const hasLight = blocks.some((block) => block.selector === `html[data-theme="${id}"]`);
      const hasDark = blocks.some((block) => block.selector === `html.dark[data-theme="${id}"]`);
      if (!hasLight || !hasDark) {
        problems.push(
          `${file}：主题 ${id} 必须同时给出浅色与深色两块（现缺 ${hasLight ? "深色" : "浅色"}）`,
        );
      }
    }
  }

  // 清单与 CSS 一一对应：少一个会露出不存在的选项，多一个则主题切了没反应
  for (const id of COLOR_THEME_IDS) {
    if (id === "default") continue;
    if (!declaredThemes.has(id)) {
      problems.push(`lib/themes.ts：主题 ${id} 没有对应的 styles/themes/*.css 定义`);
    }
  }
  for (const id of declaredThemes.keys()) {
    if (!(COLOR_THEME_IDS as readonly string[]).includes(id)) {
      problems.push(`styles/themes：主题 ${id} 没有登记在 lib/themes.ts 的 COLOR_THEME_IDS`);
    }
  }

  return problems;
};
