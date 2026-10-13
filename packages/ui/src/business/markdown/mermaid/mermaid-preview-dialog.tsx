/**
 * 图表全屏预览：把图铺满一屏看细节。
 *
 * 视口交互（拖拽平移、滚轮平移、Ctrl 加滚轮缩放、加减号键缩放）与缩放工具条走通用的
 * `ZoomablePreview`，与图片预览同一套手感。
 */
import { useTranslation } from "react-i18next";
import { ZoomablePreview } from "../../dialog/zoomable-preview";

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

  return (
    <ZoomablePreview
      description={t("图表全屏预览：拖拽平移，Ctrl 加滚轮缩放")}
      onClose={onClose}
      title={title}
    >
      {/* 预览的是同一份 mermaid 输出，没有 React 侧的等价表示 */}
      <div aria-label={title} dangerouslySetInnerHTML={{ __html: svg }} role="img" />
    </ZoomablePreview>
  );
}
