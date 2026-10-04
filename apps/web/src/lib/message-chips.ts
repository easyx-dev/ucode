/**
 * 用户消息里展开块的还原。
 *
 * 服务端把 `@` 引用与 `/skill:name` 展开成不可信边界块前置进正文：
 *   <skill name="x" location="…">…</skill>\n\n<context path="…" lines="…">…</context>\n\n用户原文
 * 历史回放时把它们还原成 chip、只展示用户真正输入的内容（块内容不再展开）。
 * 块内容已由服务端的 `neutralizeTags` 转义同名标签，匹配首个闭合标签是安全的。
 */
export type SkillChip = { name: string };
export type ContextChip = { path: string; lines?: string };

export type ParsedUserMessage = {
  skill?: SkillChip;
  contexts: ContextChip[];
  /** 用户原文（已剥掉前置的展开块） */
  text: string;
};

const SKILL_PATTERN = /^<skill name="([^"]*)" location="[^"]*">\n[\s\S]*?\n<\/skill>\n{0,2}/;
const CONTEXT_PATTERN =
  /^<context path="([^"]*)"(?: lines="([^"]*)")?>\n[\s\S]*?\n<\/context>\n{0,2}/;

export const parseUserMessage = (raw: string): ParsedUserMessage => {
  let text = raw;
  let skill: SkillChip | undefined;
  const contexts: ContextChip[] = [];

  const skillMatch = text.match(SKILL_PATTERN);
  if (skillMatch) {
    skill = { name: skillMatch[1] ?? "" };
    text = text.slice(skillMatch[0].length);
  }

  // 多个 `@` 引用连续前置，逐个剥离
  let match = text.match(CONTEXT_PATTERN);
  while (match) {
    contexts.push({ path: match[1] ?? "", ...(match[2] ? { lines: match[2] } : {}) });
    text = text.slice(match[0].length);
    match = text.match(CONTEXT_PATTERN);
  }

  return { skill, contexts, text };
};
