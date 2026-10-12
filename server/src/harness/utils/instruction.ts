/**
 * 后台模型调用的消息拼装：把指令与待处理的资料合进同一条 user 消息。
 *
 * 这些调用一度只在 `systemPrompt` 里下指令，但部分代理 / 模型会无视 system（或 developer）角色，
 * 把资料当成普通提问直接作答——标题变成回答的第一行、回顾与校验解析不出 JSON。
 * 内联进 user 消息后对任何模型都有效，所以后台调用一律走这里，不依赖系统提示词。
 */

/** 资料起止标记：让模型看清指令到哪结束、资料从哪开始，不要拿资料当指令 */
const MATERIAL_START = "=====以下是待处理的资料（开始）=====";
const MATERIAL_END = "=====以下是待处理的资料（结束）=====";

/** 资料里出现同名标记时的形态：只改首个字符，原文仍可读，但不再与真标记同形 */
const ESCAPED_START = `＝${MATERIAL_START.slice(1)}`;
const ESCAPED_END = `＝${MATERIAL_END.slice(1)}`;

/** 资料可能带着外部内容（网页、命令输出）：先破坏其中的同名标记，否则后面的文字会被当成新指令 */
const neutralizeMarkers = (text: string): string =>
  text.replaceAll(MATERIAL_START, ESCAPED_START).replaceAll(MATERIAL_END, ESCAPED_END);

/** 拼出一条 user 消息正文：指令在前、资料在中；`closing` 是资料之后的收尾强调，省略即不要 */
export const buildInstructionMessage = (
  instructions: string,
  material: string,
  closing?: string,
): string =>
  [
    instructions,
    "",
    MATERIAL_START,
    neutralizeMarkers(material),
    MATERIAL_END,
    ...(closing ? ["", closing] : []),
  ].join("\n");
