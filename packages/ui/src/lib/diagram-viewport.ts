/**
 * 图表预览视口的坐标换算：围绕指针缩放、平移累加、适配窗口。
 *
 * 只做纯计算、不碰 DOM——弹层负责测量，规则集中在这里才好单测。变换语义与 CSS 的
 * `translate(...) scale(...)` 一致：先按内容坐标缩放，再整体平移。
 */

export type DiagramPoint = {
  /** 视口内水平坐标 */
  x: number;
  /** 视口内垂直坐标 */
  y: number;
};

export type DiagramTransform = {
  /** 缩放倍数 */
  scale: number;
  /** 水平位移（视口坐标，未乘缩放） */
  translateX: number;
  /** 垂直位移（视口坐标，未乘缩放） */
  translateY: number;
};

/** 缩放范围：再小看不清、再大只是把像素拉成马赛克 */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** 适配窗口时四周留的呼吸位 */
const FIT_PADDING = 32;

/** 滚轮缩放灵敏度：触控板捏合与 Ctrl 加滚轮共用 */
const WHEEL_ZOOM_RATE = 0.01;

export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

/** 缩放时保持 `point` 处的内容不动：先反解出该点对应的内容坐标，再按新比例摆回去 */
export const zoomAtPoint = (
  transform: DiagramTransform,
  point: DiagramPoint,
  nextScale: number,
): DiagramTransform => {
  const current = clampScale(transform.scale);
  const scale = clampScale(nextScale);
  const contentX = (point.x - transform.translateX) / current;
  const contentY = (point.y - transform.translateY) / current;
  return {
    scale,
    translateX: point.x - contentX * scale,
    translateY: point.y - contentY * scale,
  };
};

export const panBy = (transform: DiagramTransform, delta: DiagramPoint): DiagramTransform => ({
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
}): DiagramTransform => {
  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);
  const scale = clampScale(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
  );

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
  point: DiagramPoint;
  /** 当前变换 */
  transform: DiagramTransform;
  /** 是否缩放：Ctrl / Meta 按下 */
  zoom: boolean;
}): DiagramTransform =>
  zoom
    ? zoomAtPoint(transform, point, transform.scale * Math.exp(-deltaY * WHEEL_ZOOM_RATE))
    : panBy(transform, { x: -deltaX, y: -deltaY });
