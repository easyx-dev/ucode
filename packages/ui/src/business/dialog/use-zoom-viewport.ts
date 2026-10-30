/**
 * 可缩放预览视口的交互：拖拽平移、滚轮平移、Ctrl 加滚轮缩放、触控板捏合、加减号键缩放、适配窗口与重置。
 *
 * 手感抄 ZCode 的预览弹层，但滚轮与捏合必须自己挂**非 passive** 的原生监听：React 的 `onWheel` 是 passive，
 * 里面的 `preventDefault()` 会被浏览器忽略，Mac 触控板捏合（Chromium 发带 `ctrlKey` 的 wheel、Safari 发
 * `gesture*`）就会落到浏览器默认的页面缩放上。
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyWheel,
  clampScale,
  fitToViewport,
  panBy,
  type ViewportPoint,
  type ViewportTransform,
  zoomAtPoint,
} from "./zoom-viewport";

const IDENTITY: ViewportTransform = { scale: 1, translateX: 0, translateY: 0 };

/** 按钮与快捷键的缩放步长：一次约 ±20%，手感接近常见的看图工具 */
const ZOOM_STEP_IN = 1.18;
const ZOOM_STEP_OUT = 0.85;

/** 内容在内容坐标系里的边界；`x` / `y` 是原点偏移（SVG 的 viewBox 可以不为 0） */
type ContentBounds = { height: number; width: number; x: number; y: number };

/**
 * 量内容层的固有尺寸（内容坐标系）。
 *
 * 含 SVG 时先按 viewBox 把内容层与 SVG 都钉成像素：mermaid 的输出是 `width="100%"` 加 `max-width=viewBox 宽度`，
 * 只把它铺进容器会把父级宽度缩成几百像素，换算出的缩放就与视觉对不上。图片这类由内容自身撑开的内容层
 * 直接用布局尺寸。
 */
const measureContent = (content: HTMLDivElement): ContentBounds | null => {
  const svg = content.querySelector("svg");
  if (svg instanceof SVGSVGElement) {
    const box = svg.viewBox.baseVal;
    const width = box.width > 0 ? box.width : svg.clientWidth;
    const height = box.height > 0 ? box.height : svg.clientHeight;
    if (width <= 0 || height <= 0) return null;
    content.style.width = `${width}px`;
    content.style.height = `${height}px`;
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.maxWidth = "none";
    return { height, width, x: box.x, y: box.y };
  }
  const { offsetHeight: height, offsetWidth: width } = content;
  return width > 0 && height > 0 ? { height, width, x: 0, y: 0 } : null;
};

/** Safari 的 GestureEvent 带相对手势起点的比例；缺失或非法时按 1 处理 */
const readGestureScale = (event: Event): number => {
  const scale = (event as Event & { scale?: number }).scale;
  return typeof scale === "number" && scale > 0 ? scale : 1;
};

/** 挂原生监听：`wheel` 与 Safari 的 `gesture*` 都要非 passive，否则挡不住浏览器缩放 */
const bindViewportGestures = (
  viewport: HTMLDivElement,
  handlers: { onGesture: (event: Event) => void; onWheel: (event: WheelEvent) => void },
): (() => void) => {
  const gestureTypes = ["gesturestart", "gesturechange", "gestureend"];
  viewport.addEventListener("wheel", handlers.onWheel, { passive: false });
  for (const type of gestureTypes) {
    viewport.addEventListener(type, handlers.onGesture, { passive: false });
  }
  return () => {
    viewport.removeEventListener("wheel", handlers.onWheel);
    for (const type of gestureTypes) viewport.removeEventListener(type, handlers.onGesture);
  };
};

export type ZoomableViewportOptions = {
  /** 内容是否已就绪：图片要等解码完才有固有尺寸，届时据此再适配一次 */
  contentReady?: boolean;
};

export type ZoomableViewport = {
  /** 挂到视口层上的 callback ref：Radix 的 `DialogContent` 首帧不渲染子内容，普通 ref + 空依赖 effect 会绑定到 null */
  setViewportRef: (node: HTMLDivElement | null) => void;
  /** 承载内容、被 transform 的那一层 */
  contentRef: RefObject<HTMLDivElement | null>;
  /** 当前变换，直接写进内容层的 style */
  transformStyle: { transform: string };
  /** 当前比例（百分比整数），给下拉按钮显示 */
  zoomPercent: number;
  fitContent: () => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
};

export function useZoomableViewport({
  contentReady = true,
}: ZoomableViewportOptions = {}): ZoomableViewport {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 元素本身也要进 state：原生监听要等它真正挂上才能绑，靠空依赖 effect 会碰上空 ref
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewportNode(node);
  }, []);
  const dragRef = useRef<{ origin: ViewportPoint; transform: ViewportTransform } | null>(null);
  const gestureRef = useRef<{ scale: number; transform: ViewportTransform } | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>(IDENTITY);
  // 捏合的手势起点要回看当时的变换，而事件回调不便取最新 state，这里在每次渲染后同步一份
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  });

  /** 量内容与视口：内容尺寸拿不到（尚未布局 / 字节没到）时返回 null */
  const measure = useCallback((): { content: ContentBounds; viewport: DOMRect } | null => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return null;
    const bounds = measureContent(content);
    return bounds ? { content: bounds, viewport: viewport.getBoundingClientRect() } : null;
  }, []);

  const fitContent = useCallback(() => {
    const measured = measure();
    if (!measured) {
      setTransform(IDENTITY);
      return;
    }
    const { content, viewport } = measured;
    setTransform(
      fitToViewport({
        contentHeight: content.height,
        contentWidth: content.width,
        contentX: content.x,
        contentY: content.y,
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
      }),
    );
  }, [measure]);

  /** 重置回到 1:1 并居中：比 fitContent 更贴近「看清原始尺寸」的诉求 */
  const reset = useCallback(() => {
    const measured = measure();
    if (!measured) {
      setTransform(IDENTITY);
      return;
    }
    const { content, viewport } = measured;
    setTransform({
      scale: 1,
      translateX: (viewport.width - content.width) / 2 - content.x,
      translateY: (viewport.height - content.height) / 2 - content.y,
    });
  }, [measure]);

  const zoomAtViewportCenter = useCallback((next: (scale: number) => number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    setTransform((current) => zoomAtPoint(current, center, next(current.scale)));
  }, []);

  const zoomBy = useCallback(
    (factor: number) => zoomAtViewportCenter((scale) => scale * factor),
    [zoomAtViewportCenter],
  );

  const zoomTo = useCallback(
    (scale: number) => zoomAtViewportCenter(() => clampScale(scale)),
    [zoomAtViewportCenter],
  );

  // 打开即适配：等一帧让弹层完成布局，否则量到的是 0 尺寸；内容晚到（图片）时再适配一次
  useEffect(() => {
    if (!viewportNode || !contentReady) return;
    const frame = window.requestAnimationFrame(fitContent);
    return () => window.cancelAnimationFrame(frame);
  }, [contentReady, fitContent, viewportNode]);

  useEffect(() => {
    const handleResize = (): void => fitContent();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitContent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      // 带修饰键的加减号留给浏览器（Cmd / Ctrl + `-` 是页面缩放），只接管裸键
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP_IN);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomBy(ZOOM_STEP_OUT);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomBy]);

  useEffect(() => {
    if (!viewportNode) return;
    const viewport = viewportNode;

    const handleWheel = (event: WheelEvent): void => {
      // 这里的 preventDefault 才是真正挡住浏览器页面缩放的一步（非 passive 监听）
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const zoom = event.ctrlKey || event.metaKey;
      setTransform((current) =>
        applyWheel({ deltaX: event.deltaX, deltaY: event.deltaY, point, transform: current, zoom }),
      );
    };

    const handleGesture = (event: Event): void => {
      event.preventDefault();
      if (event.type === "gesturestart") {
        gestureRef.current = {
          scale: readGestureScale(event),
          transform: transformRef.current,
        };
        return;
      }
      if (event.type === "gestureend") {
        gestureRef.current = null;
        return;
      }
      const active = gestureRef.current;
      if (!active) return;
      const rect = viewport.getBoundingClientRect();
      const center = { x: rect.width / 2, y: rect.height / 2 };
      const factor = readGestureScale(event) / active.scale;
      setTransform(zoomAtPoint(active.transform, center, active.transform.scale * factor));
    };

    return bindViewportGestures(viewport, { onGesture: handleGesture, onWheel: handleWheel });
  }, [viewportNode]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = viewport.getBoundingClientRect();
      dragRef.current = {
        origin: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        transform,
      };
    },
    [transform],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag) return;
    const rect = viewport.getBoundingClientRect();
    setTransform(
      panBy(drag.transform, {
        x: event.clientX - rect.left - drag.origin.x,
        y: event.clientY - rect.top - drag.origin.y,
      }),
    );
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const transformStyle = useMemo(
    () => ({
      transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
    }),
    [transform],
  );

  return {
    contentRef,
    fitContent,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    setViewportRef,
    transformStyle,
    zoomBy,
    zoomPercent: Math.round(transform.scale * 100),
    zoomTo,
  };
}
