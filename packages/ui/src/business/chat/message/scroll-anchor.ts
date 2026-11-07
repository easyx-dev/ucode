/**
 * 虚拟列表的行高变化补偿判定：一条消息实测出真实高度后，要不要为它补一次滚动位置。
 *
 * 视口上方那一行变高或变矮会把可见内容整体挪走，看上去就是视口自己跳了一下。图表、图片、代码高亮
 * 都在挂载后才落定，长消息的估算高度与实测能差出几千像素，不补的话每翻过一片没实测过的区域都要挪一次位。
 * 虚拟列表默认在向上翻时一律不补，这里不分方向，只按变化发生在锚点上方还是下方判断。
 */
import type { VirtualItem } from "@tanstack/react-virtual";

/** 判定要读的实例状态（虚拟列表实例本身就是这个形状） */
export type ScrollAnchorReadings = {
  /** 当前滚动位置：虚拟列表自己跟踪的值，与元素的 `scrollTop` 可能有半帧差 */
  scrollOffset: number | null;
  /** 已经累加、还没被滚动事件确认的补偿量 */
  scrollAdjustments: number;
  /** 已实测过的行高，键是行 key；没有条目即这一行还没量过 */
  itemSizeCache: Map<VirtualItem["key"], number>;
};

/**
 * 首次实测的估算只代表「上方那一整块」，所以行哪怕只是跨过视口顶也要补；
 * 再次实测只补完全在视口上方的那一行——跨过视口顶的行是在锚点之下变化的（正在读的那条还在往下长），
 * 补了反而把视口往下拽。
 */
export const shouldAdjustScrollPositionOnItemSizeChange = (
  item: VirtualItem,
  _delta: number,
  instance: ScrollAnchorReadings,
): boolean => {
  const offset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  return instance.itemSizeCache.has(item.key)
    ? item.start + item.size <= offset
    : item.start < offset;
};
