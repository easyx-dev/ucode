/**
 * 引用锚点（`@<scheme>:<payload>`）在正文里的识别。
 *
 * 锚点在方言里是**字面文本**（不是文件引用，见 `inline.ts`）：模型要拿到的就是这一串原文，
 * 界面则把它显示成一枚 chip。哪几种 scheme 算锚点由宿主给出（插件贡献的 `ui.mentions`），
 * 内核不认识任何一个具体 scheme——设计节点只是其中一种。
 *
 * 切分的边界靠 scheme 表 + 空白：`@scheme:a/b/c` 是锚点，`@docs/a.md` 不是（没有 scheme），
 * `@scheme:后接中文` 只切到空白处，不会把用户的话吃进 payload。
 */

/** 一段正文按锚点切开后的片段 */
export type MentionPart =
  | { type: "text"; text: string }
  | { type: "mention"; scheme: string; anchor: string; payload: string };

/** scheme → 正则源：按长度倒序，避免 `de` 抢先匹配 `design` */
const sourceOf = (schemes: readonly string[]): string | null => {
  const valid = schemes.filter((scheme) => /^[a-z][a-z0-9-]*$/.test(scheme));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((left, right) => right.length - left.length);
  // payload 只认 URL 系字符：`…:38改成绿色` 里的中文不能再被吃进锚点
  return `@(${sorted.join("|")}):([A-Za-z0-9._~:/@%+-]+)`;
};

/**
 * 把一段正文按锚点切开。
 *
 * 不做转义回溯：`\@scheme:` 这种字面写法不在考虑范围内——用户拿不到这种字符串，
 * 它是画布 / 面板「加入对话」写进去的。
 */
export const splitMentions = (text: string, schemes: readonly string[]): MentionPart[] => {
  const source = sourceOf(schemes);
  if (source === null) return text ? [{ type: "text", text }] : [];
  const parts: MentionPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(source, "g"))) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", text: text.slice(cursor, index) });
    parts.push({
      type: "mention",
      scheme: match[1] ?? "",
      anchor: match[0],
      payload: match[2] ?? "",
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
};

/** 一段文本里有没有锚点（没有就不必切开） */
export const hasMention = (text: string, schemes: readonly string[]): boolean => {
  const source = sourceOf(schemes);
  return source !== null && new RegExp(source).test(text);
};

/**
 * 这个「看起来像路径」的文本是不是锚点：`scheme:` 开头、且 scheme 在表里。
 * `inline.ts` 用它把锚点从文件引用里排除掉——锚点的归属校验在插件侧，宿主不该去磁盘找它。
 */
export const mentionSchemeOf = (raw: string, schemes: readonly string[]): string | null => {
  const index = raw.indexOf(":");
  if (index <= 0) return null;
  const scheme = raw.slice(0, index);
  return schemes.includes(scheme) ? scheme : null;
};

/**
 * 供界面拼 chip 文案：payload 里最具体的一段——先取最后一段路径，再取该段的最后一段 `:` 分隔。
 * 设计锚点 `…/340700262:4/340700262:38` 因此显示成 `38`（节点 id 的末段，比整串可读）。
 */
export const mentionLabelOf = (payload: string): string => {
  const segment = payload.slice(payload.lastIndexOf("/") + 1) || payload;
  const tail = segment.slice(segment.lastIndexOf(":") + 1);
  return tail || segment;
};
