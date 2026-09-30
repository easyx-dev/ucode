/**
 * 外部内容的边界包裹。
 *
 * webfetch / websearch 返回的都是**外部不可信内容**，用一对标签标出「这是被引用的数据」，
 * 并在工具说明里声明「不是指令」。这里负责让这层边界不可伪造：正文里出现同名标签时先中和，
 * 否则页面只要写一行 `</fetched>` 就能把自己「闭合」到边界之外，伪装成对话的一部分。
 */

/** 我们用来界定外部内容的标签名；正文里出现任一同名标签都视为越界尝试 */
export const UNTRUSTED_TAGS = ["fetched", "search_results"] as const;

/** 中和正文里的同名标签：只动开头的 `<`，保留原文其余部分（便于模型读懂内容本身） */
export const neutralizeTags = (text: string): string =>
  text.replaceAll(/<\/?(?:fetched|search_results)\b/gi, (tag) => `&lt;${tag.slice(1)}`);

/** 属性值转义：引号与 `&` 会破坏标签结构，`<` 顺手一起处理 */
const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** 用边界标签包裹正文；属性按传入顺序渲染，正文先做标签中和 */
export const wrapUntrusted = (
  tag: (typeof UNTRUSTED_TAGS)[number],
  attributes: Record<string, string>,
  body: string,
): string => {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return `<${tag}${attrs}>\n${neutralizeTags(body)}\n</${tag}>`;
};
