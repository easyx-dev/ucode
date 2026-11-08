/**
 * 内置浮窗：像 PS 的面板那样悬在内容上，可拖动、可拉伸、可收起到标题栏。
 *
 * 三条约束来自「它是画布上的一块工具面」这个定位：
 *
 * 1. **不许拖出容器**：窗口始终完整留在父容器里，贴边停住（几何计算见 `utils/floating-panel`）；
 * 2. **尺寸有上下限**：最小尺寸保证内容点得到，最大尺寸与容器一起收；
 * 3. **收起来只留标题栏**：收起后仍可拖、仍可点开——它不是「关闭」，画布上这两个面板一直存在。
 *
 * 位置 / 尺寸 / 收起状态按 `storageKey` 落 localStorage：同一块界面下次打开还在原处。
 * 容器变小（工作台被拖窄）时把窗口重新收进边界，不让它跑到看不见的地方。
 */
import { cn } from "cn";
import { ChevronDown, GripVertical } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  clampRect,
  dragRect,
  type FloatArea,
  type FloatLimits,
  type FloatRect,
  resizeRect,
} from "../utils/floating-panel";
import { IconButton } from "./button";

/** 标题栏高度：收起后剩下就是它，也是拖动把手 */
export const FLOATING_PANEL_HEADER_HEIGHT = 36;

/** 右下角拉伸把手的命中边宽 */
const RESIZE_EDGE = 10;

/** 浮窗离容器边缘的留白 */
const PADDING = 12;

export type FloatingPanelProps = {
  /** 标题栏文字 */
  title: string;
  /** localStorage 键（含品牌前缀由调用方给）：位置 / 尺寸 / 收起状态都记在它下面 */
  storageKey: string;
  children: ReactNode;
  /** 初始位置（相对容器左上角）；首次打开且没有记忆时用 */
  defaultPosition?: { x: number; y: number };
  /**
   * 首次打开贴哪个角（没有记忆时用）。贴右 / 贴底要在量到容器尺寸之后才算得出位置，
   * 所以它不能由 `defaultPosition` 表达。
   */
  defaultCorner?: "top-left" | "top-right" | "bottom-right";
  defaultSize?: { width: number; height: number };
  limits?: Partial<FloatLimits>;
  /** 首次打开是否收起（只留标题栏）：次要面板默认收起，不挡主面板 */
  defaultCollapsed?: boolean;
};

type StoredState = FloatRect & { collapsed: boolean };

const DEFAULT_LIMITS: FloatLimits = {
  minWidth: 160,
  minHeight: 120,
  maxWidth: 420,
  maxHeight: 640,
};

/** 读记忆；坏数据当没有 */
const readStored = (key: string): StoredState | null => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<StoredState>;
    if (
      typeof value.x !== "number" ||
      typeof value.y !== "number" ||
      typeof value.width !== "number" ||
      typeof value.height !== "number"
    ) {
      return null;
    }
    return {
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      collapsed: value.collapsed === true,
    };
  } catch {
    return null;
  }
};

export function FloatingPanel({
  title,
  storageKey,
  children,
  defaultPosition = { x: 12, y: 12 },
  defaultCorner = "top-left",
  defaultSize = { width: 240, height: 320 },
  defaultCollapsed = false,
  limits: limitOverrides,
}: FloatingPanelProps) {
  const { t } = useTranslation();
  const limits: FloatLimits = { ...DEFAULT_LIMITS, ...limitOverrides };
  // 上下限通过 ref 读：调用方常常直接写对象字面量，放进 effect 依赖会每次重挂监听
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<FloatRect>(() => {
    const stored = readStored(storageKey);
    return stored ?? { ...defaultPosition, ...defaultSize };
  });
  const [collapsed, setCollapsed] = useState(
    () => readStored(storageKey)?.collapsed ?? defaultCollapsed,
  );
  /**
   * 是否已经有「用户指定过的位置」：读过记忆，或用户拖动 / 拉伸过。
   *
   * 没指定过就一直跟着 `defaultCorner` 走——容器变宽变窄、收起展开都重新贴角；
   * 用户一旦动过它，位置就是他的，任何重排都不许覆盖。
   */
  const placed = useRef(readStored(storageKey) !== null);
  /** 拖动 / 拉伸进行中的起点：位移按「相对起点」算，避免累积误差 */
  /** 收起状态也进 ref：手势回调挂在 window 上，读 state 会拿到注册那一刻的旧值 */
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const gesture = useRef<
    | { kind: "drag"; pointerId: number; start: FloatRect; from: { x: number; y: number } }
    | {
        kind: "resize";
        pointerId: number;
        start: FloatRect;
        from: { x: number; y: number };
        edge: { right: boolean; bottom: boolean };
      }
    | null
  >(null);

  /** 窗口的边界就是最近的定位祖先（画布区域）；量不到就退回父元素 */
  const areaElement = useCallback((): HTMLElement | null => {
    const panel = panelRef.current;
    if (panel === null) return null;
    return (panel.offsetParent as HTMLElement | null) ?? panel.parentElement;
  }, []);

  const areaOf = useCallback((): FloatArea => {
    const element = areaElement();
    return {
      width: element?.clientWidth ?? window.innerWidth,
      height: element?.clientHeight ?? window.innerHeight,
    };
  }, [areaElement]);

  /**
   * 还没被用户摆过的窗口交给 CSS 贴角（`right` / `bottom` 而不是算出来的 `left` / `top`）。
   *
   * 用 JS 算坐标时，容器尺寸在挂载后还在变（工作台先排版、再分配宽度），一次算错就钉死在那儿；
   * 交给 CSS 之后容器怎么变都跟着，也不需要观察器。
   */
  const cornerStyle = (): CSSProperties => {
    if (defaultCorner === "top-right") return { right: PADDING, top: PADDING };
    if (defaultCorner === "bottom-right") return { right: PADDING, bottom: PADDING };
    return { left: defaultPosition.x, top: defaultPosition.y };
  };

  /**
   * 这一下手势从哪里开始。
   *
   * 还没摆过位的窗口位置由 CSS 贴着角给，`rect` 里没有真实坐标——第一次动手要先用 DOM 几何
   * 把它落成绝对坐标，否则拖动会从默认值起算，一按下去窗口就跳。
   */
  const gestureStart = (): FloatRect => {
    if (placed.current) return rect;
    const area = areaElement();
    const panel = panelRef.current;
    if (area === null || panel === null) return rect;
    const areaBox = area.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return {
      ...rect,
      x: panelBox.left - areaBox.left,
      y: panelBox.top - areaBox.top,
    };
  };

  /** 用户动过之后：位置改成绝对坐标，并把窗口收在容器里（容器变小时也收一次） */
  useEffect(() => {
    const area = areaElement();
    if (area === null) return;
    const clampNow = (): void => {
      if (!placed.current) return;
      const element = areaElement();
      if (element === null) return;
      setRect((prev) => clampRect(prev, areaOf(), limitsRef.current));
    };
    clampNow();
    const observer = new ResizeObserver(clampNow);
    observer.observe(area);
    // 容器尺寸变化时 `offsetParent` 也可能换人（换视图 / 换分栏），重新挂到新的那个上
    return () => observer.disconnect();
  }, [areaElement, areaOf]);

  // 位置 / 尺寸 / 收起状态都落盘：同一块界面下次打开还在原处
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...rect, collapsed }));
    } catch {
      // 存不了就算了：面板位置不值得报错
    }
  }, [collapsed, rect, storageKey]);

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    next: { kind: "drag" } | { kind: "resize"; edge: { right: boolean; bottom: boolean } },
  ): void => {
    if (event.button !== 0) return;
    // 标题栏里的按钮 / 输入是它们自己的：这里一旦 preventDefault + setPointerCapture，
    // 随后的 click 会被重定向成标题栏（按下点与抬起点的共同祖先），收起按钮就点不动了
    const target = event.target as Element | null;
    if (target?.closest("button, a, input, textarea, select") != null) {
      return;
    }
    // 第一次动手：把 CSS 贴角的位置落成绝对坐标，之后位置就归用户
    const start = gestureStart();
    if (!placed.current) {
      placed.current = true;
      setRect(start);
    }
    event.preventDefault();
    event.stopPropagation();
    const from = { x: event.clientX, y: event.clientY };
    gesture.current =
      next.kind === "drag"
        ? { kind: "drag", pointerId: event.pointerId, start, from }
        : { kind: "resize", pointerId: event.pointerId, start, from, edge: next.edge };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件里没有活动指针
    }
  };

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const current = gesture.current;
      // 只认发起这一次手势的那根指针：第二根手指按下会覆盖起点，两根手指会一起驱动同一个面板
      if (current === null || event.pointerId !== current.pointerId) return;
      const delta = { x: event.clientX - current.from.x, y: event.clientY - current.from.y };
      const area = areaOf();
      const bounds = limitsRef.current;
      setRect(
        current.kind === "drag"
          ? // 收起时只有标题栏：边界要按可见高度收，否则拖不到容器底部
            dragRect(
              current.start,
              delta,
              area,
              collapsedRef.current ? FLOATING_PANEL_HEADER_HEIGHT : current.start.height,
            )
          : resizeRect(current.start, delta, current.edge, area, bounds),
      );
    };
    const onUp = (): void => {
      gesture.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    // 指针在窗口外抬起时拿不到 pointerup：失焦也收尾，否则回到窗口一动鼠标面板就跟着走
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [areaOf]);

  const height = collapsed ? FLOATING_PANEL_HEADER_HEIGHT : rect.height;

  return (
    <section
      ref={panelRef}
      className="absolute z-10 flex flex-col overflow-hidden rounded-lg bg-popover shadow-dialog ring-1 ring-border-strong"
      style={{
        ...(placed.current ? { left: rect.x, top: rect.y } : cornerStyle()),
        width: rect.width,
        height,
      }}
      aria-label={title}
    >
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs text-foreground-subtle select-none",
          collapsed ? "border-b-0" : undefined,
        )}
        // 标题栏就是拖动把手：光标与命中区都在它上面
        onPointerDown={(event) => beginGesture(event, { kind: "drag" })}
        style={{ cursor: "grab", touchAction: "none" }}
      >
        <GripVertical className="size-icon-xs shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <IconButton
          className="shrink-0 text-foreground-subtle hover:text-foreground"
          label={collapsed ? t("展开面板") : t("收起面板")}
          size="icon-xs"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <ChevronDown
            className={cn("size-icon-xs transition-transform", collapsed && "-rotate-90")}
          />
        </IconButton>
      </div>

      {collapsed ? null : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      )}

      {collapsed ? null : (
        <>
          {/* 只留右下角一个把手：右缘与底缘现在各有一条自绘滚动条，10px 的拉伸条正好压在上面，
              拖滚动条会变成拉面板。角上那 10px 仍盖住两条滚动条的末端，取舍是够用就好 */}
          <div
            className="absolute right-0 bottom-0 cursor-nwse-resize"
            style={{ width: RESIZE_EDGE, height: RESIZE_EDGE, touchAction: "none" }}
            onPointerDown={(event) =>
              beginGesture(event, { kind: "resize", edge: { right: true, bottom: true } })
            }
          />
        </>
      )}
    </section>
  );
}
