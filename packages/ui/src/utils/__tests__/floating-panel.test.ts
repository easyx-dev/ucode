/** 浮窗几何：拖动贴边、尺寸上下限、容器比最小值还小的兜底 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampPosition,
  clampRect,
  dragRect,
  type FloatLimits,
  resizeRect,
} from "../floating-panel";

const area = { width: 800, height: 600 };
const limits: FloatLimits = { minWidth: 160, minHeight: 120, maxWidth: 400, maxHeight: 500 };

describe("浮窗几何", () => {
  it("拖动不越界：贴边停住，尺寸不变", () => {
    const start = { x: 100, y: 100, width: 200, height: 200 };
    assert.deepEqual(dragRect(start, { x: -500, y: -500 }, area), {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const right = dragRect(start, { x: 900, y: 900 }, area);
    assert.equal(right.x, area.width - start.width);
    assert.equal(right.y, area.height - start.height);
  });

  it("收起的面板按可见高度收边界：能拖到容器底部", () => {
    const collapsed = { x: 0, y: 0, width: 200, height: 300 };
    // 展开高度 300 时最多到 y=300；收起只剩 36 时能到 564
    assert.equal(dragRect(collapsed, { x: 0, y: 9999 }, area).y, area.height - collapsed.height);
    assert.equal(dragRect(collapsed, { x: 0, y: 9999 }, area, 36).y, area.height - 36);
    // 尺寸原样退回：收起时的拖动不能把记忆里的展开高度夹成最小值
    assert.equal(dragRect(collapsed, { x: 0, y: 9999 }, area, 36).height, collapsed.height);
    assert.equal(clampPosition(collapsed, area, 36).height, collapsed.height);
  });

  it("尺寸收到上下限内", () => {
    const base = { x: 0, y: 0, width: 200, height: 200 };
    assert.deepEqual(clampRect({ ...base, width: 10, height: 10 }, area, limits), {
      x: 0,
      y: 0,
      width: limits.minWidth,
      height: limits.minHeight,
    });
    assert.deepEqual(clampRect({ ...base, width: 9999, height: 9999 }, area, limits), {
      x: 0,
      y: 0,
      width: limits.maxWidth,
      height: limits.maxHeight,
    });
  });

  it("拉伸只朝允许的方向长", () => {
    const start = { x: 10, y: 10, width: 200, height: 200 };
    const corner = resizeRect(start, { x: 50, y: 60 }, { right: true, bottom: true }, area, limits);
    assert.deepEqual(corner, { x: 10, y: 10, width: 250, height: 260 });
    // 只拉右边：高度不动
    const edge = resizeRect(start, { x: 50, y: 60 }, { right: true, bottom: false }, area, limits);
    assert.equal(edge.width, 250);
    assert.equal(edge.height, 200);
  });

  it("拉伸也不许超出容器：宽高各按容器与上限收", () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const wide = resizeRect(
      start,
      { x: 5000, y: 5000 },
      { right: true, bottom: true },
      area,
      limits,
    );
    assert.equal(wide.width, limits.maxWidth);
    assert.equal(wide.height, limits.maxHeight);
    // 容器只有 300 宽时，宽度不能超过容器
    const tiny = resizeRect(
      start,
      { x: 5000, y: 0 },
      { right: true, bottom: false },
      { width: 300, height: 600 },
      limits,
    );
    assert.equal(tiny.width, 300);
  });

  it("容器比最小值还小时保住最小值", () => {
    const rect = clampRect(
      { x: 0, y: 0, width: 200, height: 200 },
      { width: 100, height: 80 },
      limits,
    );
    assert.equal(rect.width, limits.minWidth);
    assert.equal(rect.height, limits.minHeight);
    // 溢出的部分靠左上角对齐，仍能看到标题栏
    assert.equal(rect.x, 0);
    assert.equal(rect.y, 0);
  });
});
