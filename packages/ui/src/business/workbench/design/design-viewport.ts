/**
 * 画布的缩放与取景：纯函数，便于单测（画布组件的其余部分都需要 DOM）。
 *
 * 坐标系约定：节点的坐标与尺寸都是**页面空间**（页面左上为原点）。绘制出来的 SVG 覆盖的是
 * 内容外接矩形（它的 viewBox 从 0 起），所以画布要先算一份「内容包络」，再把它整体平移到 (0,0)——
 * 命中框与画面必须用同一份包络，否则点选会整体偏移。
 */
import type { DesignBox } from "@ucode/contracts";

/** 缩放下限：再小就看不出内容，只会得到一块灰 */
export const DESIGN_MIN_SCALE = 0.1;

/** 缩放上限：再大只是把几个像素铺满屏幕 */
export const DESIGN_MAX_SCALE = 4;

/** 「适应视图」时四周留的呼吸空间（像素） */
export const DESIGN_FIT_PADDING = 32;

export const clampScale = (scale: number): number =>
  Math.min(DESIGN_MAX_SCALE, Math.max(DESIGN_MIN_SCALE, scale));

/** 一份内容包络：把一组页面空间的盒子并起来 */
export type DesignExtent = { minX: number; minY: number; width: number; height: number };

/**
 * 算内容包络。优先用全部节点盒子的并集（含子节点，超出的也能看见）；
 * 一个盒子都没有时退回渲染给的外接矩形（空画布为 null）。
 */
export const designExtent = (
  boxes: Record<string, DesignBox>,
  fallback: DesignBox | null,
): DesignExtent | null => {
  const values = Object.values(boxes);
  if (values.length === 0) {
    if (fallback === null) return null;
    return { minX: fallback.x, minY: fallback.y, width: fallback.width, height: fallback.height };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of values) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { minX, minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
};

/**
 * 「适应视图」的比例：让整个包络落进可视区，且**不放大**（超过 100% 只会让人以为画稿变大了）。
 * 包络为空或可视区还没量到尺寸时回落 1。
 */
export const fitScale = (
  extent: DesignExtent | null,
  area: { width: number; height: number },
): number => {
  if (extent === null || extent.width <= 0 || extent.height <= 0) return 1;
  if (area.width <= 0 || area.height <= 0) return 1;
  const usableWidth = Math.max(1, area.width - DESIGN_FIT_PADDING * 2);
  const usableHeight = Math.max(1, area.height - DESIGN_FIT_PADDING * 2);
  return clampScale(Math.min(1, usableWidth / extent.width, usableHeight / extent.height));
};

/**
 * 缩放档位：往大取下一档 / 往小取上一档，落在最后一档就停在那里。
 *
 * 档位密到「一次只有一两成的变化」——原先 1 → 1.5 → 2 这种大跳，点两下就过头，
 * 而设计稿看的是像素级的东西，需要能停在自己想看的比例上。档位里都是常用的整数百分比。
 */
export const STEP_SCALES = [
  0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4,
] as const;

export const stepScale = (scale: number, direction: 1 | -1): number => {
  if (direction === 1) {
    return STEP_SCALES.find((step) => step > scale + 1e-6) ?? DESIGN_MAX_SCALE;
  }
  const smaller = [...STEP_SCALES].reverse().find((step) => step < scale - 1e-6);
  return smaller ?? DESIGN_MIN_SCALE;
};

/** 比例文案：整百不带小数（`100%`），其余留一位（`75%` / `33%` / `133.3%`） */
export const formatScale = (scale: number): string => {
  // 0.33 × 100 在浮点下是 33.000000000000004，先按一位小数收一次再判整数
  const percent = Math.round(scale * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
};

/**
 * 视口：平移量（屏幕像素）与缩放。
 *
 * 画布不用原生滚动：内容盒固定大小的话，能滚的范围就等于内容本身，拖不出边界。
 * 改成「一层内容 + 一个变换」之后，平移量是自由数值——想拖多远拖多远（Figma 那种无限画布），
 * 缩放也能绕光标锚定。
 */
export type DesignView = { scale: number; x: number; y: number };

/** 平移视口：`dx` / `dy` 是屏幕像素，正数往右下 */
export const panView = (view: DesignView, dx: number, dy: number): DesignView => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * 绕某个屏幕点缩放：该点下的画稿内容保持不动。
 *
 * 屏幕位置 = `view.x + (页面坐标 − 包络原点) × scale`，代入「换比例后同一页面坐标仍停在原屏幕位置」
 * 就得到下面这个式子（包络原点在推导里消掉了，所以不需要知道它）。
 */
export const zoomViewAt = (
  view: DesignView,
  cursor: { x: number; y: number },
  nextScale: number,
): DesignView => {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return {
    scale,
    x: cursor.x - (cursor.x - view.x) * ratio,
    y: cursor.y - (cursor.y - view.y) * ratio,
  };
};

/** 适应视图：内容居中，只缩不放 */
export const fitView = (
  extent: DesignExtent | null,
  area: { width: number; height: number },
): DesignView => {
  const scale = fitScale(extent, area);
  if (extent === null) return { scale, x: 0, y: 0 };
  return {
    scale,
    x: (area.width - extent.width * scale) / 2,
    y: (area.height - extent.height * scale) / 2,
  };
};

/** 框选矩形：两个角点归一成「左上 + 尺寸」 */
export type DesignMarquee = { x: number; y: number; width: number; height: number };

export const normalizeMarquee = (
  from: { x: number; y: number },
  to: { x: number; y: number },
): DesignMarquee => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y),
});

/**
 * 框选命中：盒子与矩形**相交**即算选中（不是「被完全包含」）。
 *
 * 画布上的节点常常比画框大（整块画板），要求完全包含的话框选几乎永远选不到东西；
 * 相交是 Figma 这类工具的默认口径。
 */
export const nodesInMarquee = (
  boxes: Record<string, DesignBox>,
  marquee: DesignMarquee,
): string[] =>
  Object.entries(boxes)
    .filter(
      ([, box]) =>
        box.x < marquee.x + marquee.width &&
        box.x + box.width > marquee.x &&
        box.y < marquee.y + marquee.height &&
        box.y + box.height > marquee.y,
    )
    .map(([id]) => id);
