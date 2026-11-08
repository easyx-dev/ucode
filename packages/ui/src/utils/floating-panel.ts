/**
 * 浮窗的几何：拖动与拉伸的边界计算（纯函数，便于单测）。
 *
 * 两条硬约束由这里保证，组件只管把指针位移喂进来：
 * 1. **不许拖出容器**：窗口始终完整地留在容器里（贴边停住，不是越界后弹回）；
 * 2. **尺寸有上下限**：不小于最小值（再小就点不到内容），不大于最大值，也不超出容器。
 *
 * 坐标是相对容器的像素（左上原点），尺寸是像素。
 */

export type FloatRect = { x: number; y: number; width: number; height: number };

export type FloatArea = { width: number; height: number };

export type FloatLimits = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
};

export type FloatDelta = { x: number; y: number };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 把窗口收进容器，并把尺寸收到上下限内。
 *
 * 容器比最小值还小时（工作台拖得极窄）优先保住最小值——窗口溢出也比缩成一条缝可点。
 */
export const clampRect = (rect: FloatRect, area: FloatArea, limits: FloatLimits): FloatRect => {
  const width = clamp(rect.width, limits.minWidth, Math.min(limits.maxWidth, area.width));
  const height = clamp(rect.height, limits.minHeight, Math.min(limits.maxHeight, area.height));
  return {
    width,
    height,
    x: clamp(rect.x, 0, Math.max(0, area.width - width)),
    y: clamp(rect.y, 0, Math.max(0, area.height - height)),
  };
};

/**
 * 只收位置：按 `visibleHeight`（当前画出来的高度，收起时只有标题栏）保证窗口完整留在容器里。
 *
 * 尺寸原样退回：收起时高度是记忆值，不能因为「这一下只有 36px」被夹成最小值而丢掉展开高度。
 */
export const clampPosition = (
  rect: FloatRect,
  area: FloatArea,
  visibleHeight: number = rect.height,
): FloatRect => {
  const { x, y } = clampRect({ ...rect, height: visibleHeight }, area, {
    minWidth: 0,
    minHeight: 0,
    maxWidth: rect.width,
    maxHeight: visibleHeight,
  });
  return { ...rect, x, y };
};

/**
 * 拖动：只动位置，尺寸不变，贴边停住。
 *
 * `visibleHeight` 默认取 `start.height`；收起的面板要显式传标题栏高度，
 * 否则横条会被记忆里的展开高度挡在容器中部以下，拖不到底。
 */
export const dragRect = (
  start: FloatRect,
  delta: FloatDelta,
  area: FloatArea,
  visibleHeight: number = start.height,
): FloatRect =>
  clampPosition({ ...start, x: start.x + delta.x, y: start.y + delta.y }, area, visibleHeight);

/**
 * 拉伸：从右下角（或右边 / 下边）拉，`edge` 说明这一下允许拉哪两个方向。
 * 左上角固定不动——Photoshop 的面板也是拖右下角变大。
 */
export const resizeRect = (
  start: FloatRect,
  delta: FloatDelta,
  edge: { right: boolean; bottom: boolean },
  area: FloatArea,
  limits: FloatLimits,
): FloatRect =>
  clampRect(
    {
      ...start,
      width: edge.right ? start.width + delta.x : start.width,
      height: edge.bottom ? start.height + delta.y : start.height,
    },
    area,
    limits,
  );
