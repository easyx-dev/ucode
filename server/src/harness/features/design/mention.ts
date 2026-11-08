/**
 * 引用锚点：画布选中节点 → 对话 → 工具入参之间那条可解析的线索。
 *
 * 形状 `@design:<会话 id>/<页 id>/<节点 id>`。**必须带会话**：锚点写进对话历史后比文档活得久，
 * 只带节点 id 时，另一轮对话里一个恰好同 id 的节点就会被误改；带上会话，跨会话的引用就变成
 * 「可检测的错」——校验直接拒绝，而不是改一个「看起来像」的节点。
 */
import { designError } from "./errors";

/** 锚点的固定前缀；半截（只有 `@design:`）表示客户端要自己拼会话 */
export const DESIGN_MENTION_SCHEME = "@design:";

/** 一个会话的锚点前缀，形如 `@design:<会话 id>`；完整锚点由它加 `/<页>/<节点>` 拼成 */
export const mentionPrefixOf = (sessionId: string): string =>
  `${DESIGN_MENTION_SCHEME}${sessionId}`;

export type DesignAnchor = {
  sessionId: string;
  pageId: string;
  nodeId: string;
};

/** 拼一个完整锚点（服务端与界面共用同一口径） */
export const formatAnchor = (prefix: string, pageId: string, nodeId: string): string =>
  `${prefix}/${pageId}/${nodeId}`;

/** 解析锚点；不是本方案的形状就返回 undefined（调用方按「入参不成立」处理） */
export const parseAnchor = (value: string): DesignAnchor | undefined => {
  const text = value.trim();
  if (!text.startsWith(DESIGN_MENTION_SCHEME)) return undefined;
  const [sessionId, pageId, nodeId, ...rest] = text.slice(DESIGN_MENTION_SCHEME.length).split("/");
  if (rest.length > 0 || !sessionId || !pageId || !nodeId) return undefined;
  return { sessionId, pageId, nodeId };
};

/**
 * 把锚点折成「这一页的这个节点」，并校验会话归属。
 *
 * 只校验归属，节点是否存在由调用方在图里确认——那样报错能说出「已经删了」而不是笼统的「不匹配」。
 */
export const assertAnchorOwnership = (
  value: string,
  sessionId: string,
): { pageId: string; nodeId: string } => {
  const anchor = parseAnchor(value);
  if (anchor === undefined) {
    throw designError(
      "invalid_input",
      `认不出这个设计引用：${value}`,
      "引用的形状是 @design:<会话>/<页>/<节点>，从画布右键「加入对话」得到的那一枚可以直接用",
    );
  }
  if (anchor.sessionId !== sessionId) {
    throw designError(
      "anchor_mismatch",
      "这个设计引用来自别的会话，不能在本会话里用",
      "回到它所属的那次对话里改，或者用 design_get_tree 取本会话当前的节点 id",
    );
  }
  return { pageId: anchor.pageId, nodeId: anchor.nodeId };
};
