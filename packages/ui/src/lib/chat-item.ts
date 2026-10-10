/** 会话条目在界面上最常用的两个读法：稳定 key 与正文文本（正文以外的区块不进文本） */
import type { ChatItem } from "./types";

/**
 * 行 key 与轮标识的来源：`uid` 跨「乐观条目 → 权威条目」不变，而 `id` 会在 `message_end` 换成服务端 id。
 * 拿 `id` 当 key 的话，每次落定都会把整行卸载重建——生成中看得到的闪一下。
 */
export const uidOf = (item: ChatItem): string => item.uid ?? item.id;

/** 条目的正文文本；图片 / 附件 / 工具调用块不参与 */
export const itemText = (item: ChatItem): string =>
  item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
