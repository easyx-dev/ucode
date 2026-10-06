/**
 * 用户消息里的引用：正文里的 `@` 标记与前置展开块的还原。
 *
 * 服务端把 `@` 引用与 `/skill:name` 展开成不可信边界块前置进正文：
 *   <skill name="x" location="…">…</skill>\n\n<context path="…" lines="…">…</context>\n\n用户原文
 * 块内容只喂给模型，界面整体剥掉它们（不展开、不成段），技能的 chip 由 `skill` 字段给出；
 * 块内容已由服务端的 `neutralizeTags` 转义同名标签，匹配首个闭合标签是安全的。
 *
 * 文件引用是句子成分：编辑器插入引用时由 `docToPayload` 在正文里写下 `@<路径>` 标记，发送前换成相对
 * 工作目录的写法（与服务端展开块上的 `path` 属性同口径），回放时它就留在用户写的那句话里——标记与
 * 展开块的对应因此可逆，只有图片、技能与附件才是句子外的 chip。
 */
import type { ComposerPayload } from "./composer-payload";
import { toRelativePath } from "./path";

export type SkillChip = { name: string };
export type AttachmentChip = { id: string; name: string };

export type ParsedUserMessage = {
  skill?: SkillChip;
  attachments: AttachmentChip[];
  /** 用户原文（已剥掉前置的展开块，`@` 引用标记留在原位置） */
  text: string;
};

const SKILL_PATTERN = /^<skill name="([^"]*)" location="[^"]*">\n[\s\S]*?\n<\/skill>\n{0,2}/;
const CONTEXT_PATTERN = /^<context path="[^"]*"(?: lines="[^"]*")?>\n[\s\S]*?\n<\/context>\n{0,2}/;
/** 非图片附件的引用行（服务端前置进正文）：`[附件: name (id: <sha256>)]` */
// i18n-ignore：协议字面量，与 server 的 run.ts 保持一致，不是界面文案
const ATTACHMENT_PATTERN = /^\[附件: (.*?) \(id: ([0-9a-f]{64})\)\]\n{0,2}/;

/** `@` 引用的正文标记；标记与展开块一一对应，界面靠它还原引用在句子里的位置 */
export const contextMarker = (path: string): string => `@${path}`;

/**
 * 把正文里的引用标记换成本会话工作目录下的相对写法（与服务端展开块的 `path` 属性同口径）。
 * 载荷里的标记是编辑器插入的绝对路径，逐条按已知引用精确替换，不会误伤用户自己打的 `@`；
 * 认不出工作目录（或引用不在其下）时保持原样，正文里仍是一条完整的路径。
 */
export const relativizeContextRefs = (payload: ComposerPayload, cwd?: string): ComposerPayload => {
  if (!cwd || payload.contexts.length === 0) return payload;
  const text = payload.contexts.reduce(
    (current, ref) =>
      current.replaceAll(contextMarker(ref.path), contextMarker(toRelativePath(cwd, ref.path))),
    payload.text,
  );
  return text === payload.text ? payload : { ...payload, text };
};

export const parseUserMessage = (raw: string): ParsedUserMessage => {
  let text = raw;
  let skill: SkillChip | undefined;
  const attachments: AttachmentChip[] = [];

  const skillMatch = text.match(SKILL_PATTERN);
  if (skillMatch) {
    skill = { name: skillMatch[1] ?? "" };
    text = text.slice(skillMatch[0].length);
  }

  // 多个 `@` 引用连续前置，逐个剥离（内容不展开，位置在正文的标记里）
  let context = text.match(CONTEXT_PATTERN);
  while (context) {
    text = text.slice(context[0].length);
    context = text.match(CONTEXT_PATTERN);
  }

  // 紧随其后是非图片附件的引用行（一行一个）
  let attachment = text.match(ATTACHMENT_PATTERN);
  while (attachment) {
    attachments.push({ name: attachment[1] ?? "", id: attachment[2] ?? "" });
    text = text.slice(attachment[0].length);
    attachment = text.match(ATTACHMENT_PATTERN);
  }

  return { skill, attachments, text };
};
