/**
 * Mermaid 图块：图源 → 渲染好的图，渲染不出来就回落源码；图可双击或点右上角按钮开全屏预览。
 *
 * 回落刻意不做错误面板——流式未闭合、粘进来的非标准语法都是常态，为一张图弹一次错误提示会打断阅读，
 * 而源码本身仍然可读。尺寸由 mermaid 给定，宽图在块内横向滚动，不缩字。
 */
import { Loader2, Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { useMermaidSvg } from "../hooks/use-mermaid-svg";
import { openDialog } from "../lib/dialog";
import { MermaidPreviewDialog } from "./mermaid-preview-dialog";

export function MermaidBlock({ code, deferred }: { code: string; deferred?: boolean }) {
  const { t } = useTranslation();
  // 流式途中只出源码：此时图源大概率还没写完，渲染必然失败，还会白跑一次布局
  const state = useMermaidSvg(code, !deferred);
  const svg = state.status === "ready" ? state.svg : null;

  const openPreview = (): void => {
    if (!svg) return;
    void openDialog((close) => (
      <MermaidPreviewDialog svg={svg} title={t("图表预览")} onClose={() => close()} />
    ));
  };

  if (svg) {
    return (
      <div className="md-mermaid group/mermaid">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 双击只是顺手的增强入口，键盘与读屏走右上角的按钮 */}
        <div className="md-mermaid-viewport" onDoubleClick={openPreview}>
          <div
            role="img"
            aria-label={t("图表")}
            className="flex min-h-24 min-w-max items-center justify-center"
            // mermaid 直接产出 SVG 字符串，没有 React 侧的等价表示
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <Button
          aria-label={t("全屏查看")}
          className="absolute top-2 right-2 bg-card/80 opacity-0 backdrop-blur-sm transition group-hover/mermaid:opacity-100 focus-visible:opacity-100"
          onClick={openPreview}
          size="icon-xs"
          title={t("全屏查看")}
          type="button"
          variant="ghost"
        >
          <Maximize2 />
        </Button>
      </div>
    );
  }

  if (state.status === "rendering") {
    return (
      <div className="md-mermaid">
        <div className="md-mermaid-viewport flex min-h-24 items-center justify-center gap-2 text-foreground-subtle text-xs">
          <Loader2 className="size-icon-sm animate-spin" />
          <span>{t("图表渲染中…")}</span>
        </div>
      </div>
    );
  }

  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}
