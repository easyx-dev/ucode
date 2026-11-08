/**
 * 一张设计稿的画布：工具条 + 画布 + 可折叠的图层树。
 *
 * 标签按**会话**一格（标题是当前稿的文件名），节点树在标签里面；稿子清单在清单页
 * （见 `design-files-list`），两者各占满主区。
 * 打开标签就是把这份文件设成本会话的当前稿（见 `design-canvas`），所以这里只有一种模式：
 * 选中写回服务端、节点可加入对话、可换页新建页。
 */
import { brand } from "@ucode/brand/values";
import type { DesignBox, DesignNodeSummary, DesignPage } from "@ucode/contracts";
import {
  Check,
  ChevronDown,
  FilePlus2,
  Maximize2,
  MessageSquarePlus,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, IconButton } from "../../../base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { FloatingPanel } from "../../../base/floating-panel";
import { Spinner } from "../../../base/spinner";
import { useCanvasViewport } from "../../../hooks/use-canvas-viewport";
import { DesignInspector } from "./design-inspector";
import { DesignLayers } from "./design-layers";
import { DesignSurface } from "./design-surface";
import { designExtent, formatScale } from "./design-viewport";

export type DesignTabView = {
  /** 这份稿子的文件路径（标签标题与「当前」判定都用它） */
  path: string;
  pages: readonly DesignPage[];
  pageId: string;
  svg: string;
  boxes: Record<string, DesignBox>;
  bounds: DesignBox | null;
  nodes: readonly DesignNodeSummary[];
  selection: readonly string[];
  loading: boolean;
  warning?: string;
  /** 空态说明：画布还没有内容时给一句「怎么让它有东西」 */
  emptyHint?: string;
  /** 本会话 id：属性浮窗读会话文档时用 */
  sessionId: string;
  /** 文档代数：变了属性浮窗要重取 */
  revision: number;
  /** 图层树被服务端截断（节点多到一次下发不完） */
  truncated?: boolean;
  /** 以下动作都指向「本会话当前在改的那份」；画布打开即指向 */
  onSelect?: (ids: readonly string[]) => void;
  onInsert?: (nodeId: string) => void;
  onPageChange?: (pageId: string) => void;
  onCreatePage?: () => void;
  onReload?: () => void;
  mentionPrefix?: string;
};

export function DesignTabView(view: DesignTabView) {
  const { t } = useTranslation();
  // 视口在标签这一层：工具条的缩放 / 适应视图 / 比例与画布共用同一个，不能各持一份
  const extent = useMemo(() => designExtent(view.boxes, view.bounds), [view.boxes, view.bounds]);
  const viewport = useCanvasViewport(extent);

  if (view.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="@container flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        {/*
          页面控件：**一份文件多页**，所以它常驻（单页也显示），新建页收在同一个菜单里。
          之前单页时不显示、新建是一颗挨着「放大」的 +，看的人以为一个文件只能有一页。
        */}
        {view.pages.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* 走 Button 而不是 IconButton：带 Tooltip 的 IconButton 不是 DOM 节点，菜单点不开 */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-20 min-w-0 justify-between gap-1 px-2 text-xs @[24rem]:max-w-32"
                aria-label={t("选择页面")}
              >
                <span className="min-w-0 truncate">
                  {view.pages.find((page) => page.id === view.pageId)?.name ?? ""}
                </span>
                <ChevronDown className="size-icon-xs shrink-0 text-foreground-subtle" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-40">
              {view.pages.map((page) => (
                <DropdownMenuItem
                  key={page.id}
                  disabled={view.onPageChange === undefined}
                  onSelect={() => view.onPageChange?.(page.id)}
                >
                  <span className="min-w-0 truncate">{page.name}</span>
                  {page.id === view.pageId ? <Check className="ml-auto size-icon-sm" /> : null}
                </DropdownMenuItem>
              ))}
              {view.onCreatePage === undefined ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => view.onCreatePage?.()}>
                    <FilePlus2 className="size-icon-sm" />
                    {t("新建页面")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <IconButton
          className="text-foreground-subtle hover:text-foreground"
          label={t("缩小")}
          size="icon-sm"
          onClick={() => viewport.zoomStep(-1)}
        >
          <Minus className="size-icon-sm" />
        </IconButton>
        <span className="hidden min-w-11 text-center text-xs text-foreground-subtle tabular-nums @[19rem]:inline">
          {formatScale(viewport.view.scale)}
        </span>
        <IconButton
          className="text-foreground-subtle hover:text-foreground"
          label={t("放大")}
          size="icon-sm"
          onClick={() => viewport.zoomStep(1)}
        >
          <Plus className="size-icon-sm" />
        </IconButton>
        <IconButton
          className="text-foreground-subtle hover:text-foreground"
          label={t("适应视图")}
          size="icon-sm"
          onClick={viewport.fit}
        >
          <Maximize2 className="size-icon-sm" />
        </IconButton>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {view.onReload === undefined ? null : (
            <IconButton
              className="text-foreground-subtle hover:text-foreground"
              label={t("重新载入")}
              size="icon-sm"
              onClick={view.onReload}
            >
              <RefreshCw className="size-icon-sm" />
            </IconButton>
          )}
          {view.selection.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              aria-label={t("加入对话（{{count}} 个）", { count: view.selection.length })}
              onClick={() => {
                for (const id of view.selection) view.onInsert?.(id);
              }}
            >
              <MessageSquarePlus className="size-icon-sm" />
              <span className="hidden @[30rem]:inline">
                {t("加入对话（{{count}} 个）", { count: view.selection.length })}
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      {view.warning === undefined ? null : (
        <div className="shrink-0 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-foreground-subtle">
          {view.warning}
        </div>
      )}

      {/* 图层面板浮在画布右侧：工作台可以被拖得很窄，占宽的话画布就没地方了 */}
      <div className="relative flex min-h-0 flex-1">
        <DesignSurface
          viewport={viewport}
          extent={extent}
          svg={view.svg}
          boxes={view.boxes}
          bounds={view.bounds}
          nodes={view.nodes}
          pageId={view.pageId}
          selection={view.selection}
          fitKey={`${view.path}#${view.pageId}`}
          {...(view.onSelect ? { onSelect: view.onSelect } : {})}
          {...(view.onInsert ? { onInsert: view.onInsert } : {})}
          {...(view.mentionPrefix ? { mentionPrefix: view.mentionPrefix } : {})}
          {...(view.emptyHint ? { emptyHint: view.emptyHint } : {})}
        />
        {/* 两个浮窗：图层在左上、属性在右上（可拖动、可拉伸、可收起到标题栏） */}
        <FloatingPanel
          title={t("图层")}
          storageKey={`${brand.slug}-float-design-layers`}
          defaultSize={{ width: 240, height: 320 }}
        >
          <DesignLayers
            nodes={view.nodes}
            selection={view.selection}
            {...(view.onSelect ? { onSelect: view.onSelect } : {})}
            {...(view.truncated === true ? { truncated: true } : {})}
          />
        </FloatingPanel>
        <FloatingPanel
          title={t("属性")}
          storageKey={`${brand.slug}-float-design-inspector`}
          defaultCorner="bottom-right"
          defaultCollapsed
          defaultSize={{ width: 260, height: 360 }}
        >
          <DesignInspector
            sessionId={view.sessionId}
            nodeId={view.selection[0] ?? null}
            revision={view.revision}
          />
        </FloatingPanel>
      </div>
    </div>
  );
}
