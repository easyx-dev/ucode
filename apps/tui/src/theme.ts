import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui";

/**
 * 终端配色：与 Web 同一套语义（accent / muted / faint / success / warn / danger / border），
 * 但降级成 **256 色**——真彩色（`38;2;R;G;B`）在不少终端里仍是空白，256 色到处都认。
 *
 * 换色只改这里：视图层只调 `tint.*` 这样的语义名，不在各处硬编码转义序列。
 */
const fg = (code: number) => (text: string) => `\u001B[38;5;${code}m${text}\u001B[0m`;

const on = (prefix: string, code: number) => (text: string) =>
  `\u001B[${prefix};38;5;${code}m${text}\u001B[0m`;

export const tint = {
  /** 品牌色（sky-500 的 256 色近似）：用户输入条、进行中、强调。 */
  accent: fg(39),
  accentBold: on("1", 39),
  content: fg(255),
  muted: fg(247),
  faint: fg(243),
  success: fg(41),
  warn: fg(220),
  danger: fg(203),
  border: fg(238),
  code: fg(252),
} as const;

export const ink = {
  bold: (text: string) => `\u001B[1m${text}\u001B[0m`,
  dim: (text: string) => `\u001B[2m${text}\u001B[0m`,
  italic: (text: string) => `\u001B[3m${text}\u001B[0m`,
  underline: (text: string) => `\u001B[4m${text}\u001B[0m`,
  strike: (text: string) => `\u001B[9m${text}\u001B[0m`,
} as const;

/**
 * Markdown 主题（助手正文用它渲染）。
 *
 * 码块不做语法高亮：基座没给高亮器，引一个高亮库只为终端着色不划算；
 * 用"边框暗、正文亮"把码块与正文分开即可（终端里对比度比配色更可靠）。
 */
export const MARKDOWN_THEME: MarkdownTheme = {
  heading: (text) => tint.accentBold(text),
  link: (text) => ink.underline(tint.accent(text)),
  linkUrl: (text) => tint.faint(text),
  code: (text) => tint.code(text),
  codeBlock: (text) => tint.code(text),
  codeBlockBorder: (text) => tint.border(text),
  codeBlockIndent: "  ",
  quote: (text) => tint.muted(text),
  quoteBorder: (text) => tint.border(text),
  hr: (text) => tint.border(text),
  listBullet: (text) => tint.accent(text),
  bold: (text) => ink.bold(tint.content(text)),
  italic: (text) => ink.italic(tint.content(text)),
  strikethrough: (text) => ink.strike(tint.muted(text)),
  underline: (text) => ink.underline(tint.content(text)),
};

const SELECT_THEME: SelectListTheme = {
  selectedPrefix: (text) => tint.accent(text),
  selectedText: (text) => ink.bold(text),
  description: (text) => tint.muted(text),
  scrollInfo: (text) => tint.faint(text),
  noMatch: (text) => tint.faint(text),
};

export const EDITOR_THEME: EditorTheme = {
  borderColor: (text) => tint.border(text),
  selectList: SELECT_THEME,
};

export { SELECT_THEME };
