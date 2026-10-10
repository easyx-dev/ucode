/**
 * 图表全屏预览：把图铺满一屏看细节。
 *
 * 手感参照 ZCode 的预览弹层：缩小 / 比例 / 放大排在工具条右侧，视口内拖拽平移、滚轮平移、
 * Ctrl 加滚轮缩放、加减号键缩放；弹层外壳用 `FullscreenDialog`，尺寸与关闭方式与表格、图片一致。
 */
import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../base/dropdown-menu";
import { useDiagramViewport, ZOOM_PRESETS } from "../hooks/use-diagram-viewport";
import { FullscreenDialog, FullscreenToolbarButton } from "./fullscreen-dialog";

export function MermaidPreviewDialog({
  svg,
  title,
  onClose,
}: {
  svg: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const viewport = useDiagramViewport();

  return (
    <FullscreenDialog
      description={t("图表全屏预览：拖拽平移，Ctrl 加滚轮缩放")}
      onClose={onClose}
      title={title}
      actions={
        <>
          <FullscreenToolbarButton label={t("缩小")} onClick={() => viewport.zoomBy(0.85)}>
            <ZoomOut />
          </FullscreenToolbarButton>
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
              <DropdownMenuItem onSelect={viewport.fit}>{t("适配窗口")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={viewport.reset}>{t("重置缩放")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <FullscreenToolbarButton label={t("放大")} onClick={() => viewport.zoomBy(1.18)}>
            <ZoomIn />
          </FullscreenToolbarButton>
        </>
      }
    >
      <div
        ref={viewport.setViewportRef}
        className="relative min-h-0 cursor-grab touch-none overflow-hidden bg-popover active:cursor-grabbing"
        onPointerCancel={viewport.onPointerUp}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
      >
        <div
          ref={viewport.contentRef}
          aria-label={title}
          className="absolute top-0 left-0 origin-top-left select-none [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none"
          // 预览的是同一份 mermaid 输出，没有 React 侧的等价表示
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
          style={viewport.transformStyle}
        />
      </div>
    </FullscreenDialog>
  );
}
