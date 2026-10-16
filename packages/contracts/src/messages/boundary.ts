/**
 * 不可信内容的边界标签：服务端把「被引用的数据」包进一对标签，模型与客户端都靠它区分
 * 「这是数据」还是「对话本身」。
 *
 * 两侧共用这一份名单：服务端据此包裹并中和正文里的伪造同名标签（`harness/utils/boundary`），
 * 客户端据此把用户消息里的展开块切回 chip（`@ucode/markdown` 的 `entry.ts`）。名字一改，两边必须同时改。
 */

/** 联网抓取回来的页面正文 */
export const FETCHED_TAG = "fetched";

/** 联网搜索的结果列表 */
export const SEARCH_RESULTS_TAG = "search_results";

/** `@` 引用展开的上下文 */
export const CONTEXT_TAG = "context";

/** `/name args` 展开的提示词命令 */
export const COMMAND_TAG = "command";

/** `/skill:name args` 展开的技能正文 */
export const SKILL_TAG = "skill";

/**
 * 全部边界标签。服务端的中和正则由它派生——新增一种边界时只改这里，
 * 漏加会让该边界可被正文里的同名标签伪造。
 */
export const BOUNDARY_TAGS = [
  FETCHED_TAG,
  SEARCH_RESULTS_TAG,
  CONTEXT_TAG,
  COMMAND_TAG,
  SKILL_TAG,
] as const;

export type BoundaryTag = (typeof BOUNDARY_TAGS)[number];
