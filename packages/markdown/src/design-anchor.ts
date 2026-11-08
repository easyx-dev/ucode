/**
 * 设计画布锚点（`@design:<会话>/<页>/<节点>`）在正文里的识别。
 *
 * 锚点在方言里是**字面文本**（不是文件引用，见 `inline.ts` 的说明），所以它不会变成「引用 chip」，
 * 消息气泡里会露出一长串 `@design:uuid/…`。这个模块把一段文本按锚点切开，让界面把它渲染成一枚 chip。
 *
 * 两端都要求是 `数字:数字`（SDK 的节点 id 形状），否则边界定不住：`…:38改成绿色` 会把后面的中文
 * 一起吃进节点 id。形状对不上时整段按普通文本处理——宁可不高亮，也不要把用户的话吞掉。
 */
/** 一段正文按设计锚点切开后的片段 */
export type DesignAnchorPart =
  | { type: "text"; text: string }
  | { type: "designAnchor"; anchor: string; pageId: string; nodeId: string };

/**
 * 锚点全文：`@design:` + 会话 id（不含斜杠）+ 页 id + 节点 id，后两段是 `数字:数字`。
 *
 * 末尾的 `(?!\d)` 是边界：`…:3:4:5` 这种更长的 id 不该被截成 `3:4` 认下来（那会把半截锚点
 * 高亮、把剩下的 `:5` 留成正文）。
 */
const DESIGN_ANCHOR_SOURCE = "@design:([^/\\s]+)/(\\d+:\\d+)/(\\d+:\\d+)(?!\\d|:\\d)";

/** 每次新建一个带 `g` 的正则：共用一个全局正则会被 `lastIndex` 影响 */
const designAnchorPattern = (): RegExp => new RegExp(DESIGN_ANCHOR_SOURCE, "g");

/**
 * 把一段正文按设计锚点切成片段。
 *
 * 不做转义回溯：`\@design:` 这种字面写法不在考虑范围内——用户拿不到这种字符串，
 * 它是画布「加入对话」写进去的。
 */
export const splitDesignAnchors = (text: string): DesignAnchorPart[] => {
  const parts: DesignAnchorPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(designAnchorPattern())) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", text: text.slice(cursor, index) });
    parts.push({
      type: "designAnchor",
      anchor: match[0],
      pageId: match[2] ?? "",
      nodeId: match[3] ?? "",
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
};

/** 一段文本里有没有设计锚点（没有就不必切开） */
export const hasDesignAnchor = (text: string): boolean => designAnchorPattern().test(text);

/** 供界面拼 chip 文案：节点 id 的最后一段（同一份稿里唯一，比整串可读） */
export const designAnchorLabel = (nodeId: string): string =>
  nodeId.slice(nodeId.lastIndexOf(":") + 1) || nodeId;
