/**
 * 可缩放预览外壳：全屏弹层 + 拖拽 / 滚轮 / 捏合的视口 + 缩放工具条，图表与图片共用一份。
 *
 * 调用方只给内容层里的东西（SVG 或图片），尺寸测量与交互都在这里；工具条与 `Esc` 之外不额外提供关闭入口。
 */
import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../base/dropdown-menu";
import { FullscreenDialog } from "./fullscreen-dialog";
import { useZoomableViewport, type ZoomableViewport } from "./use-zoom-viewport";

/** 缩放档位：比例下拉里的候选 */
const ZOOM_PRESETS = [0.5, 1, 2] as const;

/** 缩小 / 比例 / 放大，排进弹层工具条的右侧动作区 */
function ZoomToolbar({ viewport }: { viewport: ZoomableViewport }) {
  const { t } = useTranslation();

  return (
    <>
      <IconButton label={t("缩小")} onClick={() => viewport.zoomBy(0.85)}>
        <ZoomOut />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("缩放比例")}
            className="min-w-14 gap-1 font-mono"
            size="sm"
            type="button"
            variant="ghost"
          >
            <span>{viewport.zoomPercent}%</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          {ZOOM_PRESETS.map((scale) => (
            <DropdownMenuItem key={scale} onSelect={() => viewport.zoomTo(scale)}>
              {`${Math.round(scale * 100)}%`}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={viewport.fitContent}>{t("适配窗口")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={viewport.reset}>{t("重置缩放")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label={t("放大")} onClick={() => viewport.zoomBy(1.18)}>
        <ZoomIn />
      </IconButton>
    </>
  );
}

export function ZoomablePreview({
  children,
  contentReady,
  description,
  onClose,
  title,
}: {
  /** 内容层里的东西：SVG 或图片 */
  children: ReactNode;
  /** 内容是否已就绪；不传即视为就绪（静态内容） */
  contentReady?: boolean;
  /** 读屏说明 */
  description: string;
  onClose: () => void;
  /** 工具条标题，同时作为弹层的可访问名 */
  title: string;
}) {
  const viewport = useZoomableViewport({ contentReady });

  return (
    <FullscreenDialog
      actions={<ZoomToolbar viewport={viewport} />}
      description={description}
      onClose={onClose}
      title={title}
    >
      <div
        ref={viewport.setViewportRef}
        className="relative min-h-0 cursor-grab touch-none overflow-hidden bg-popover active:cursor-grabbing"
        onPointerCancel={viewport.onPointerUp}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
      >
        {/* `[&_svg]` 的规矩是防内联元素的基线间隙，图片自己带 `block` */}
        <div
          ref={viewport.contentRef}
          className="absolute top-0 left-0 origin-top-left select-none [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none"
          style={viewport.transformStyle}
        >
          {children}
        </div>
      </div>
    </FullscreenDialog>
  );
}
