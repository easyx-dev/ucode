/**
 * 画布视口：平移与缩放（无限画布）+ 中键拖动 / 双指滚动的接线。
 *
 * 会话里的设计画布与文件树里的只读预览共用这一份：两处的「怎么拖着看」应当一模一样，
 * 各写一遍必然漂（一个支持双指另一个只认按钮）。
 *
 * 视口是**变换**而不是滚动容器：平移量是自由数值，能拖到任意远处；原生滚动能滚的范围就是内容本身。
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  type DesignExtent,
  type DesignView,
  fitView,
  panView,
  stepScale,
  zoomViewAt,
} from "../business/workbench/design/design-viewport";

/** `⌘/Ctrl + 滚轮`的缩放灵敏度：按指数走，触控板捏合的细碎增量也能跟手 */
const ZOOM_SENSITIVITY = 0.01;

/**
 * 单次事件最多放大/缩小多少。
 *
 * 捏合（触控板）每次只报几个像素的增量，而鼠标滚轮一格就是 120——不设上限的话，
 * 一格滚轮能把画面放大三倍。上限取 20%，与档位缩放（25%）同一量级。
 */
const ZOOM_MAX_STEP = 1.2;

/**
 * 滚轮增量的口径统一成像素。
 *
 * `deltaMode` 为 1（行）或 2（页）时 `deltaY` 是行数 / 页数，Firefox 与部分外设在行模式下
 * 一格只报 3：不折算的话双指滚动在那类环境里等于没反应。
 */
const lineHeightOf = (event: WheelEvent): number => {
  if (event.deltaMode === 1) return 16;
  if (event.deltaMode === 2) return 400;
  return 1;
};

export type CanvasViewport = {
  /**
   * 视口容器：滚轮与中键拖动的监听挂在它上面。
   *
   * 是回调 ref 而不是对象 ref：画布首帧可能在取数据（此时容器根本不存在），
   * 用对象 ref 时监听会绑在 null 上、之后再也不重试，滚轮与中键拖动就永久失效。
   */
  containerRef: (node: HTMLDivElement | null) => void;
  /** 内容层（已按包络平移过）：指针位置换算回页面坐标靠它量 */
  layerRef: RefObject<HTMLDivElement | null>;
  view: DesignView;
  /** 适应视图：内容居中、只缩不放 */
  fit: () => void;
  /** 以视口中心缩放；`nextScaleOf` 拿当前比例算出目标比例 */
  zoomTo: (nextScaleOf: (scale: number) => number) => void;
  /** 走一档（工具条的 − / ＋） */
  zoomStep: (direction: 1 | -1) => void;
};

export function useCanvasViewport(extent: DesignExtent | null): CanvasViewport {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<DesignView>({ scale: 1, x: 0, y: 0 });

  const containerRef = useCallback((node: HTMLDivElement | null): void => {
    elementRef.current = node;
    setContainer(node);
  }, []);

  const fit = useCallback(() => {
    const element = elementRef.current;
    if (element === null) return;
    setView(fitView(extent, { width: element.clientWidth, height: element.clientHeight }));
  }, [extent]);

  /** 以视口中心为锚点缩放 */
  const zoomTo = useCallback((nextScaleOf: (scale: number) => number) => {
    const element = elementRef.current;
    if (element === null) return;
    const cursor = { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    setView((prev) => zoomViewAt(prev, cursor, nextScaleOf(prev.scale)));
  }, []);

  const zoomStep = useCallback(
    (direction: 1 | -1) => zoomTo((scale) => stepScale(scale, direction)),
    [zoomTo],
  );

  /**
   * 滚轮：双指滚动即平移，`⌘/Ctrl + 滚轮`即缩放。
   *
   * 用原生监听而不是 React 的 `onWheel`：React 把 wheel 挂成 passive，拦不住浏览器自己的
   * 页面缩放与滚动（pinch 走的就是 ctrl + wheel）。
   */
  useEffect(() => {
    if (container === null) return;
    const element = container;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.min(
          ZOOM_MAX_STEP,
          Math.max(1 / ZOOM_MAX_STEP, Math.exp(-event.deltaY * ZOOM_SENSITIVITY)),
        );
        setView((prev) => zoomViewAt(prev, cursor, prev.scale * factor));
        return;
      }
      setView((prev) =>
        panView(prev, -event.deltaX * lineHeightOf(event), -event.deltaY * lineHeightOf(event)),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [container]);

  /** 中键拖动平移：鼠标用户的习惯，触控板用双指滚动 */
  useEffect(() => {
    if (container === null) return;
    const element = container;
    let dragging: { pointerId: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 1) return;
      event.preventDefault();
      dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // 合成事件里没有活动指针，捕获会抛；不影响拖动本身
      }
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (dragging === null || event.pointerId !== dragging.pointerId) return;
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging = { ...dragging, x: event.clientX, y: event.clientY };
      setView((prev) => panView(prev, dx, dy));
    };
    const endDrag = (): void => {
      dragging = null;
    };
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endDrag);
      element.removeEventListener("pointercancel", endDrag);
    };
  }, [container]);

  return { containerRef, layerRef, view, fit, zoomTo, zoomStep };
}
