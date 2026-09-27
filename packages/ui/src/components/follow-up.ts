/**
 * 划选追问（F-1.12）：把"选中的一段内容"变成可以直接发送的追问提示。
 *
 * 做成纯函数的原因：引用的格式（引用块、截断、空问题时的默认问法）是产品约定，
 * 与渲染无关，也最容易在边界上出错（超长选中、多行、全空白）。
 */

/** 追问时引用内容的上限（太长会把上下文挤掉，这里只保留要点）。 */
export const MAX_QUOTE_CHARS = 800;

/** 选中内容 → 引用块文本（多行各自加 `>` 前缀）。 */
export function quoteExcerpt(text: string, maxChars: number = MAX_QUOTE_CHARS): string {
  const normalized = text.replace(/\r\n/gu, "\n").trim();
  if (normalized === "") return "";
  const truncated =
    normalized.length > maxChars ? `${normalized.slice(0, maxChars).trimEnd()}…` : normalized;
  return truncated
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export const DEFAULT_FOLLOW_UP = "针对上面这段，请再展开说明。";

/** 组装追问提示：引用段 + 用户问题（没写问题就给一个默认问法）。 */
export function composeFollowUpPrompt(selection: string, question: string): string {
  const quoted = quoteExcerpt(selection);
  const ask = question.trim() === "" ? DEFAULT_FOLLOW_UP : question.trim();
  if (quoted === "") return ask;
  return `关于下面这段内容：\n${quoted}\n\n${ask}`;
}
