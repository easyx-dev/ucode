/**
 * diff 视图的 shiki 高亮适配：把项目现成的高亮引擎接进 `@git-diff-view/react`。
 *
 * 官方适配层（`@git-diff-view/shiki`）把主题写死成 github light / dark，那等于再引一套配色；
 * 这里换成 `lib/shiki-theme` 的主题——颜色全是 `var(--code-*)`，于是 diff 里的高亮与消息流的代码块、
 * 文件预览同一口径，深浅色跟着设计 token 走，也不需要 `.hljs-*` 那套类映射。
 *
 * 库要求 `getAST` **同步**返回 HAST，而语言是按需异步加载的：调用方先 `createDiffHighlighter`
 * 把语言备好，再打开 `diffViewHighlight`；备好之前铺纯文本，不阻塞渲染。
 */
import { type DiffAST, type DiffHighlighter, processAST } from "@git-diff-view/core";
// 取 `values` 入口：只有品牌串，不牵入 assets（Node 侧测试会直接加载本模块）
import { brand } from "@ucode/brand/values";

import { highlightToHast, isLanguageReady, prepareLanguage } from "./shiki";
import { HIGHLIGHT_MAX_LINES } from "./shiki-languages";

/** 适配器标识：库用它比对新旧高亮器，名字变了就重算 */
const HIGHLIGHTER_NAME = `${brand.slug}-shiki`;

export type DiffShikiHighlighter = Omit<DiffHighlighter, "getHighlighterEngine">;

/** 语言就绪时给出适配器；不认识或加载失败时返回 null（调用方据此不开高亮） */
export const createDiffHighlighter = async (
  language: string | null,
): Promise<DiffShikiHighlighter | null> => {
  if (!(await prepareLanguage(language))) return null;

  let maxLine = HIGHLIGHT_MAX_LINES;
  let ignoreList: (string | RegExp)[] = [];

  const adapter: DiffShikiHighlighter = {
    name: HIGHLIGHTER_NAME,
    // `style`：着色写在 AST 节点的 inline style 上（值即 `var(--code-*)`），不走 CSS 类
    type: "style",
    get maxLineToIgnoreSyntax() {
      return maxLine;
    },
    setMaxLineToIgnoreSyntax: (value) => {
      maxLine = value;
    },
    get ignoreSyntaxHighlightList() {
      return ignoreList;
    },
    setIgnoreSyntaxHighlightList: (value) => {
      ignoreList = value;
    },
    // 库按「一段代码 + 语言」要 AST：语言未就绪时给 undefined，它会退回纯文本
    getAST: ((raw: string, _fileName?: string, lang?: string) =>
      highlightToHast(raw, lang ?? language) ?? undefined) as DiffHighlighter["getAST"],
    processAST: processAST as (ast: DiffAST) => ReturnType<DiffShikiHighlighter["processAST"]>,
    hasRegisteredCurrentLang: (lang) => isLanguageReady(lang),
  };

  return adapter;
};
