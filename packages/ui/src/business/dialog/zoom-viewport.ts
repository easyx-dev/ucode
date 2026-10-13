/**
 * 可缩放预览视口的坐标换算：围绕指针缩放、平移累加、适配窗口。
 *
 * 只做纯计算、不碰 DOM——弹层负责测量，规则集中在这里才好单测。变换语义与 CSS 的
 * `translate(...) scale(...)` 一致：先按内容坐标缩放，再整体平移。
 */

export type ViewportPoint = {
  /** 视口内水平坐标 */
  x: number;
  /** 视口内垂直坐标 */
  y: number;
};

export type ViewportTransform = {
  /** 缩放倍数 */
  scale: number;
  /** 水平位移（视口坐标，未乘缩放） */
  translateX: number;
  /** 垂直位移（视口坐标，未乘缩放） */
  translateY: number;
};

/** 交互缩放的范围（按钮 / 滚轮 / 比例预设）：再小看不清、再大只是把像素拉成马赛克 */
const MIN_SCALE = 0.25;
const MAX_SCALE = 16;

/** 适配窗口时四周留的呼吸位 */
const FIT_PADDING = 32;

/** 滚轮缩放灵敏度：触控板捏合与 Ctrl 加滚轮共用 */
const WHEEL_ZOOM_RATE = 0.01;

/** 变换里的比例：非有限或非正一律当 1，别让它传播成 NaN 坐标 */
const validScale = (scale: number): number => (Number.isFinite(scale) && scale > 0 ? scale : 1);

/**
 * 交互缩放的比例夹取；非法值退回 1。
 *
 * `current` 是当前比例：适配窗口允许给出越界值（小图放大到铺满、长图缩到放下），此时边界放宽到当前比例，
 * 只挡住继续往越界方向走——把它拉回边界会让一次滚轮变成缩放跳变。
 */
export const clampScale = (scale: number, current?: number): number => {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  const anchor = current === undefined ? MIN_SCALE : validScale(current);
  const lower = Math.min(anchor, MIN_SCALE);
  const upper = Math.max(anchor, MAX_SCALE);
  return Math.min(upper, Math.max(lower, scale));
};

/** 缩放时保持 `point` 处的内容不动：先反解出该点对应的内容坐标，再按新比例摆回去 */
export const zoomAtPoint = (
  transform: ViewportTransform,
  point: ViewportPoint,
  nextScale: number,
): ViewportTransform => {
  const current = validScale(transform.scale);
  const scale = clampScale(nextScale, current);
  const contentX = (point.x - transform.translateX) / current;
  const contentY = (point.y - transform.translateY) / current;
  return {
    scale,
    translateX: point.x - contentX * scale,
    translateY: point.y - contentY * scale,
  };
};

export const panBy = (transform: ViewportTransform, delta: ViewportPoint): ViewportTransform => ({
  ...transform,
  translateX: transform.translateX + delta.x,
  translateY: transform.translateY + delta.y,
});

/**
 * 适配窗口：按比例缩放到刚好放下（含留白）并居中。
 * 尺寸拿不到（尚未布局）时给 1:1，别让调用方拿到 NaN 变换。
 */ export const fitToViewport = ({
  contentHeight,
  contentWidth,
  contentX = 0,
  contentY = 0,
  viewportHeight,
  viewportWidth,
}: {
  /** 内容高度（内容坐标系） */
  contentHeight: number;
  /** 内容宽度（内容坐标系） */
  contentWidth: number;
  /** 内容左上角 X */
  contentX?: number;
  /** 内容左上角 Y */
  contentY?: number;
  /** 视口高度（px） */
  viewportHeight: number;
  /** 视口宽度（px） */
  viewportWidth: number;
}): ViewportTransform => {
  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);
  // 不夹到交互缩放的上下限：适配窗口的语义是「刚好放下」，夹取会把内容留在视口外
  const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);

  return {
    scale,
    translateX: (viewportWidth - contentWidth * scale) / 2 - contentX * scale,
    translateY: (viewportHeight - contentHeight * scale) / 2 - contentY * scale,
  };
};

/**
 * 滚轮增量 → 变换：带 Ctrl（含 Mac 触控板捏合）的滚轮走缩放，其余走平移。
 * 平移方向与拖拽一致：向右滚看左边的内容，所以增量取反。
 */
export const applyWheel = ({
  deltaX,
  deltaY,
  point,
  transform,
  zoom,
}: {
  /** 水平滚动量 */
  deltaX: number;
  /** 垂直滚动量 */
  deltaY: number;
  /** 缩放锛点（视口坐标） */
  point: ViewportPoint;
  /** 当前变换 */
  transform: ViewportTransform;
  /** 是否缩放：Ctrl / Meta 按下 */
  zoom: boolean;
}): ViewportTransform =>
  zoom
    ? zoomAtPoint(transform, point, transform.scale * Math.exp(-deltaY * WHEEL_ZOOM_RATE))
    : panBy(transform, { x: -deltaX, y: -deltaY });
