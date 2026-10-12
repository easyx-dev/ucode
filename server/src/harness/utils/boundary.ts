/**
 * 边界块的包裹与中和：`<fetched>` / `<search_results>` / `<context>` / `<command>` / `<skill>` 都走这里。
 *
 * 标签分两套：契约里的那批是**对话里**的边界（客户端也按它把展开块切回 chip），本模块另加
 * `goal` / `exchange`——它们只出现在后台模型调用的输入里（目标校验、记忆回顾），客户端不解析，
 * 但同样是可被正文伪造的边界。共同点是用一对标签标出「这是被引用的数据」。
 * 这里负责让这层边界不可伪造：正文里出现同名标签时先中和，
 * 否则内容只要写一行 `</fetched>` 就能把自己「闭合」到边界之外，伪装成对话的一部分。
 */
import { BOUNDARY_TAGS, type BoundaryTag } from "@ucode/contracts";

/** 只出现在后台模型调用输入里的语义标签：客户端不解析，但同样要防伪造 */
export const PROMPT_BOUNDARY_TAGS = ["goal", "exchange"] as const;

/** 同名标签的匹配；两套名单都在这里派生，新增一种边界时不会漏改 */
const TAG_PATTERN = new RegExp(
  `</?(?:${[...BOUNDARY_TAGS, ...PROMPT_BOUNDARY_TAGS].join("|")})\\b`,
  "gi",
);

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
