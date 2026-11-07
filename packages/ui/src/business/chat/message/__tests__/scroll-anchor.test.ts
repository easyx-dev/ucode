/** 行高变化补偿判定单测：变化在锚点上方就补、在下方不补，首次实测放宽到「跨过视口顶」 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VirtualItem } from "@tanstack/react-virtual";
import { shouldAdjustScrollPositionOnItemSizeChange } from "../scroll-anchor";

const item = (start: number, size: number): VirtualItem => ({
  index: 0,
  key: "row-1",
  start,
  size,
  end: start + size,
  lane: 0,
});

/** 已实测过一次的状态：行 key 在缓存里 */
const measured = (): Map<VirtualItem["key"], number> => new Map([["row-1", 400]]);

describe("shouldAdjustScrollPositionOnItemSizeChange", () => {
  it("再次实测：整行都在视口上方才补", () => {
    const instance = { scrollOffset: 1000, scrollAdjustments: 0, itemSizeCache: measured() };
    assert.equal(
      shouldAdjustScrollPositionOnItemSizeChange(item(100, 400), 0, instance),
      true,
      "行底 500 在滚动位置 1000 之前，变高会把可见内容顶下去",
    );
    assert.equal(
      shouldAdjustScrollPositionOnItemSizeChange(item(900, 400), 0, instance),
      false,
      "行跨过视口顶：变化在锚点之下（正在读的那条还在往下长），补了会往下拽",
    );
    assert.equal(
      shouldAdjustScrollPositionOnItemSizeChange(item(1200, 400), 0, instance),
      false,
      "行完全在视口下方",
    );
  });

  it("首次实测：估算代表上方那一整块，跨过视口顶也补", () => {
    const instance = { scrollOffset: 1000, scrollAdjustments: 0, itemSizeCache: new Map() };
    assert.equal(shouldAdjustScrollPositionOnItemSizeChange(item(900, 120), 0, instance), true);
    assert.equal(shouldAdjustScrollPositionOnItemSizeChange(item(1200, 120), 0, instance), false);
  });

  it("尚未落到元素上的补偿量计入锚点位置", () => {
    const instance = {
      scrollOffset: 1000,
      scrollAdjustments: -300,
      itemSizeCache: measured(),
    };
    assert.equal(
      shouldAdjustScrollPositionOnItemSizeChange(item(500, 400), 0, instance),
      false,
      "锚点实际在 700：这一行还跨着视口顶，不能按记录位置 1000 当它在上方",
    );
  });
});
