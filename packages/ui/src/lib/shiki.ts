/**
 * 语法高亮引擎：shiki 的 fine-grained 用法（`shiki/core` + JS 引擎 + 按需语言）。
 *
 * 只引 JS RegExp 引擎而不引 Oniguruma WASM：shiki 官方兼容表里 237/238 种语言与 WASM 引擎结果一致、
 * 0 种结果不一致，唯一不支持的 `ahk2` 不在语言表内，省下 145 kB gz 的 wasm。
 * 语言表是显式映射，`import()` 的每一项各自成 chunk，只有真正预览到那种语言才会加载。
 * 本模块由 `use-highlighted-lines` 动态导入，因此不进主 bundle。
 *
 * 渲染不返回 HTML：`codeToTokens` 的结果本就是**按行分组**的 token，直接由渲染器铺成 span，
 * 于是不需要 `dangerouslySetInnerHTML`，行号、横向滚动与截断也留在渲染器手里。
 */
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { LANGS, resolveLanguageId, shouldHighlight } from "./shiki-languages";
import { CODE_THEME_NAME, codeTheme } from "./shiki-theme";

let highlighter: Promise<HighlighterCore> | null = null;
/** 已加载的语言，避免重复 `loadLanguage` */
const loaded = new Set<string>();

const getHighlighter = (): Promise<HighlighterCore> => {
  highlighter ??= createHighlighterCore({
    langs: [],
    themes: [codeTheme],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
};

/**
 * 把代码切成「按行分组的 token」；不值得高亮、语言不认识或加载失败时返回 null，
 * 调用方据此渲染纯文本——高亮是增强，不能成为预览失败的原因。
 */
export const highlightLines = async (
  code: string,
  language: string | null,
): Promise<ThemedToken[][] | null> => {
  const id = resolveLanguageId(language);
  if (id === null || !shouldHighlight(code, id)) return null;
  try {
    const instance = await getHighlighter();
    if (!loaded.has(id)) {
      const load = LANGS[id];
      if (!load) return null;
      await instance.loadLanguage((await load()) as Parameters<HighlighterCore["loadLanguage"]>[0]);
      loaded.add(id);
    }
    return instance.codeToTokens(code, { lang: id, theme: CODE_THEME_NAME }).tokens;
  } catch {
    return null;
  }
};
