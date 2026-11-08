/**
 * 画布本体：画面 + 命中框 + 选中 + 取景。
 *
 * 只吃 props：渲染什么由调用方给（会话文档或磁盘上的文件），这里只管「怎么画、怎么拖、怎么点」。
 * 视口是**变换**不是滚动：平移量是自由数值，能拖到任意远处（无限画布），双指滚动即平移、
 * `⌘/Ctrl + 滚轮`绕光标缩放、中键拖动也能平移。
 *
 * 选中由调用方决定：给了 `onSelect` 就能点选 / 框选（右键还有「加入对话」），不给就是一个观察面。
 */

import type { DesignBox, DesignNodeSummary } from "@ucode/contracts";
import { cn } from "cn";
import { Copy, MessageSquarePlus } from "lucide-react";
import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../base/context-menu";
import { Empty } from "../../../base/empty";
import type { CanvasViewport } from "../../../hooks/use-canvas-viewport";
import { type DesignExtent, nodesInMarquee, normalizeMarquee } from "./design-viewport";

/** 图层路径：芯片上给人看的那个名字 */
export const nodePathsOf = (nodes: readonly DesignNodeSummary[]): Map<string, string> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const paths = new Map<string, string>();
  for (const node of nodes) {
    const segments: string[] = [];
    let current: DesignNodeSummary | undefined = node;
    while (current !== undefined) {
      segments.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    paths.set(node.id, segments.join(" / "));
  }
  return paths;
};

export type DesignSurfaceProps = {
  /** 整页 SVG（服务端渲染）；空串显示空态 */
  svg: string;
  boxes: Record<string, DesignBox>;
  bounds: DesignBox | null;
  nodes: readonly DesignNodeSummary[];
  /** 当前页 id：复制锚点时用 */
  pageId: string;
  selection: readonly string[];
  /** 给回调就能点选 / 框选；不给就只是观察面 */
  onSelect?: (ids: string[]) => void;
  /** 右键「加入对话」；不给就没有这一项 */
  onInsert?: (nodeId: string) => void;
  /** 复制锚点的前缀（`@design:<会话>`）；不给则不复制 */
  mentionPrefix?: string;
  /** 每次换页 / 换文件时自动适应视图（key 变一次，视图重置一次） */
  fitKey: string;
  /** 空态文案 */
  emptyHint?: string;
  /** 右侧浮层（图层面板）的宽度：空态文案要让出那一块，否则被盖掉一半 */
  overlayInset?: number;
  /** 视口（工具条上的缩放与画布共用同一个） */
  viewport: CanvasViewport;
  /** 内容包络：视口按它平移，pointer → 页面坐标也按它换算 */
  extent: DesignExtent | null;
};

export function DesignSurface({
  svg,
  boxes,
  bounds,
  nodes,
  pageId,
  selection,
  onSelect,
  onInsert,
  mentionPrefix,
  fitKey,
  emptyHint,
  overlayInset,
  viewport,
  extent,
}: DesignSurfaceProps) {
  const { t } = useTranslation();
  const paths = useMemo(() => nodePathsOf(nodes), [nodes]);
  const { containerRef, layerRef, view } = viewport;
  const [marquee, setMarquee] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const selected = new Set(selection);
  const selectable = onSelect !== undefined;

  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (extent === null || fitted.current === fitKey) return;
    fitted.current = fitKey;
    viewport.fit();
  }, [extent, fitKey, viewport]);

  /**
   * 指针位置 → 页面坐标（框选用）。
   *
   * 内容层的子节点就摆在页面坐标上，它的变换把页面原点映射到图层左上——所以
   * 「相对图层矩形的偏移 ÷ 缩放」直接就是页面坐标（平移与包络原点在推导里消掉）。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: layerRef 是 ref，读 .current 不是响应式依赖
  const pagePointOf = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const layer = layerRef.current;
      if (layer === null || extent === null) return null;
      const rect = layer.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / view.scale,
        y: (event.clientY - rect.top) / view.scale,
      };
    },
    [extent, view.scale],
  );

  const finishMarquee = useCallback(
    (
      dragged: { from: { x: number; y: number }; to: { x: number; y: number } },
      additive: boolean,
    ) => {
      if (onSelect === undefined) return;
      const moved =
        Math.abs(dragged.to.x - dragged.from.x) + Math.abs(dragged.to.y - dragged.from.y);
      // 几乎没拖动 = 点了一下空白：清空选中（与画布类工具的习惯一致）
      if (moved < 2) {
        onSelect([]);
        return;
      }
      const hits = nodesInMarquee(boxes, normalizeMarquee(dragged.from, dragged.to));
      if (hits.length === 0) {
        onSelect([]);
        return;
      }
      onSelect([...new Set([...(additive ? selection : []), ...hits])]);
    },
    [boxes, onSelect, selection],
  );

  const origin = { x: extent?.minX ?? 0, y: extent?.minY ?? 0 };
  const empty = svg === "" && Object.keys(boxes).length === 0;

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/40"
    >
      {selectable ? (
        <button
          type="button"
          aria-label={t("框选或清空选中")}
          className={cn(
            "absolute inset-0 cursor-crosshair touch-none",
            marquee !== null && "select-none",
          )}
          onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0) return;
            const point = pagePointOf(event);
            if (point === null) return;
            setMarquee({ from: point, to: point });
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // 合成事件里没有活动指针，捕获会抛；不影响拖拽本身
            }
          }}
          onPointerMove={(event) => {
            if (marquee === null) return;
            const point = pagePointOf(event);
            if (point !== null) setMarquee({ from: marquee.from, to: point });
          }}
          onPointerUp={(event) => {
            const dragged = marquee;
            setMarquee(null);
            if (dragged === null) return;
            finishMarquee(dragged, event.shiftKey || event.metaKey || event.ctrlKey);
          }}
          onPointerCancel={() => setMarquee(null)}
        />
      ) : null}

      {empty ? (
        <div
          className="flex h-full"
          style={
            overlayInset !== undefined && overlayInset > 0
              ? { paddingRight: overlayInset }
              : undefined
          }
        >
          <Empty
            className="h-full flex-1"
            title={t("画布还是空的")}
            hint={emptyHint ?? t("让 agent 先出稿：设计模式里它用 design_* 工具把界面画出来")}
          />
        </div>
      ) : (
        <div
          ref={layerRef}
          className="pointer-events-none absolute top-0 left-0"
          style={{
            // 先按包络把页面原点挪到图层原点，再整体缩放，最后按视口平移：顺序不能反
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) translate(${-origin.x}px, ${-origin.y}px)`,
            transformOrigin: "top left",
          }}
        >
          <div
            className="absolute shadow-popover"
            style={{
              left: bounds?.x ?? 0,
              top: bounds?.y ?? 0,
              width: bounds?.width ?? extent?.width,
              height: bounds?.height ?? extent?.height,
            }}
            // 画面是服务端渲染的 SVG 原文；它只由本服务的 SDK 生成，不含用户输入
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {marquee === null ? null : (
            <div
              className="pointer-events-none absolute border border-dashed border-ring bg-ring/10"
              style={(() => {
                const rect = normalizeMarquee(marquee.from, marquee.to);
                return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
              })()}
            />
          )}
          {Object.entries(boxes).map(([id, box]) => {
            const node = nodes.find((item) => item.id === id);
            const active = selected.has(id);
            const target = (
              <button
                type="button"
                aria-label={paths.get(id) ?? id}
                title={paths.get(id) ?? id}
                onClick={(event) => {
                  if (!selectable) return;
                  event.stopPropagation();
                  if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    const next = new Set(selected);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    onSelect?.([...next]);
                    return;
                  }
                  onSelect?.([id]);
                }}
                className={cn(
                  "pointer-events-auto absolute rounded-none",
                  selectable ? "cursor-pointer" : "cursor-default",
                  // 命中框：直角、两档同宽（2px）。选中用画布选中色，悬停同色降透明度——
                  // 两档线宽不一致时，画面里会同时出现粗细不同的框，分不清哪个是「选中」、哪个是稿子自己的边
                  active
                    ? "ring-2 ring-canvas-selection"
                    : "hover:ring-2 hover:ring-canvas-selection/50",
                )}
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                }}
                data-design-node-id={id}
                data-design-node-name={node?.name ?? ""}
              />
            );
            // 只看不动时没有右键动作：不套菜单，免得弹出一个空壳
            if (onInsert === undefined && mentionPrefix === undefined) {
              return <Fragment key={id}>{target}</Fragment>;
            }
            return (
              <ContextMenu key={id}>
                <ContextMenuTrigger asChild>{target}</ContextMenuTrigger>
                <ContextMenuContent>
                  {onInsert === undefined ? null : (
                    <ContextMenuItem onSelect={() => onInsert(id)}>
                      <MessageSquarePlus className="size-icon-sm" />
                      {t("加入对话")}
                    </ContextMenuItem>
                  )}
                  {mentionPrefix === undefined ? null : (
                    <ContextMenuItem
                      onSelect={() => {
                        void navigator.clipboard?.writeText(`${mentionPrefix}/${pageId}/${id}`);
                      }}
                    >
                      <Copy className="size-icon-sm" />
                      {t("复制引用锚点")}
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}
    </div>
  );
}
