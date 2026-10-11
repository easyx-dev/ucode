/**
 * 边界块的包裹与中和：`<fetched>` / `<search_results>` / `<context>` / `<command>` / `<skill>` 都走这里。
 *
 * 标签名单在 `@ucode/contracts`（客户端也按它把展开块切回 chip）。webfetch / websearch 返回的是
 * **外部不可信内容**，`@` 引用、提示词命令与技能正文是要与用户原话分开的注入内容，共同点是用一对标签
 * 标出「这是被引用的数据」。这里负责让这层边界不可伪造：正文里出现同名标签时先中和，
 * 否则内容只要写一行 `</fetched>` 就能把自己「闭合」到边界之外，伪装成对话的一部分。
 */
import { BOUNDARY_TAGS, type BoundaryTag } from "@ucode/contracts";

/** 同名标签的匹配；由契约里的名单派生，新增一种边界时不会漏改 */
const TAG_PATTERN = new RegExp(`</?(?:${BOUNDARY_TAGS.join("|")})\\b`, "gi");

/** 中和正文里的同名标签：只动开头的 `<`，保留原文其余部分（便于模型读懂内容本身） */
export const neutralizeTags = (text: string): string =>
  text.replaceAll(TAG_PATTERN, (tag) => `&lt;${tag.slice(1)}`);

/** 属性值转义：引号与 `&` 会破坏标签结构，`<` 顺手一起处理 */
const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** 用边界标签包裹正文；属性按传入顺序渲染，正文先做标签中和 */
export const wrapUntrusted = (
  tag: BoundaryTag,
  attributes: Record<string, string>,
  body: string,
): string => {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return `<${tag}${attrs}>\n${neutralizeTags(body)}\n</${tag}>`;
};
