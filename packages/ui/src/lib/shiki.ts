/**
 * 语法高亮引擎：shiki 的 fine-grained 用法（`shiki/core` + JS 引擎 + 按需语言）。
 *
 * 只引 JS RegExp 引擎而不引 Oniguruma WASM：shiki 官方兼容表里 237/238 种语言与 WASM 引擎结果一致、
 * 0 种结果不一致，唯一不支持的 `ahk2` 不在语言表内，省下 145 kB gz 的 wasm。
 * 语言表是显式映射，`import()` 的每一项各自成 chunk，只有真正预览到那种语言才会加载。
 * 本模块由 `use-highlighted-lines` 与 diff 的高亮适配器**动态导入**，因此不进主 bundle。
 *
 * 两个出口共用同一实例与已加载语言集合：`highlightLines` 给预览器（按行分组的 token，
 * 渲染器自己铺 span），`highlightToHast` 给 diff 视图（`@git-diff-view/react` 要 HAST）。
 * 都不返回 HTML 字符串，所以不需要 `dangerouslySetInnerHTML`。
 */
import type { DiffAST } from "@git-diff-view/core";
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { LANGS, resolveLanguageId, shouldHighlight } from "./shiki-languages";
import { CODE_THEME_NAME, codeTheme } from "./shiki-theme";

let highlighter: Promise<HighlighterCore> | null = null;
/** 已就绪的实例：同步高亮（diff 的适配器）只能用它 */
let engine: HighlighterCore | null = null;
/** 已加载的语言，避免重复 `loadLanguage` */
const loaded = new Set<string>();

const getHighlighter = async (): Promise<HighlighterCore> => {
  highlighter ??= createHighlighterCore({
    langs: [],
    themes: [codeTheme],
    engine: createJavaScriptRegexEngine(),
  });
  engine ??= await highlighter;
  return engine;
};

/** 备好某个语言（只加载它自己的 chunk）；不认识或加载失败时返回 false */
export const prepareLanguage = async (language: string | null): Promise<boolean> => {
  const id = resolveLanguageId(language);
  if (id === null) return false;
  if (loaded.has(id)) return true;
  const load = LANGS[id];
  if (!load) return false;
  try {
    const instance = await getHighlighter();
    await instance.loadLanguage((await load()) as Parameters<HighlighterCore["loadLanguage"]>[0]);
    loaded.add(id);
    return true;
  } catch {
    return false;
  }
};

/** 语言是否已就绪（同步）：diff 的适配器据此决定给不给 AST */
export const isLanguageReady = (language: string | null): boolean => {
  const id = resolveLanguageId(language);
  return id !== null && loaded.has(id);
};

/**
 * 把代码切成「按行分组的 token」；不值得高亮或语言未就绪时返回 null，
 * 调用方据此渲染纯文本——高亮是增强，不能成为预览失败的原因。
 */
export const highlightLines = async (
  code: string,
  language: string | null,
): Promise<ThemedToken[][] | null> => {
  const id = resolveLanguageId(language);
  if (id === null || !shouldHighlight(code, id)) return null;
  if (!(await prepareLanguage(language))) return null;
  try {
    return engine?.codeToTokens(code, { lang: id, theme: CODE_THEME_NAME }).tokens ?? null;
  } catch {
    return null;
  }
};

/**
 * 单段代码 → HAST（**同步**，语言必须已就绪）：diff 视图的适配器用。
 * 库的 `getAST` 拿不到异步结果，因此未就绪时返回 null，让它先铺纯文本。
 */
export const highlightToHast = (code: string, language: string | null): DiffAST | null => {
  const id = resolveLanguageId(language);
  if (engine === null || id === null || !loaded.has(id)) return null;
  if (!shouldHighlight(code, id)) return null;
  try {
    return engine.codeToHast(code, { lang: id, theme: CODE_THEME_NAME }) as DiffAST;
  } catch {
    return null;
  }
};
