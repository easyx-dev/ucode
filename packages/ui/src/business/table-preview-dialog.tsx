/**
 * 表格全屏预览：宽表在大视图里看，正文列宽放不下的内容不用再挤。
 *
 * 复用 `md-content` 的表格排版（表头底色、单元格内边距与「表格自己横向滚动」），所以这里只出滚动容器。
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FullscreenDialog } from "./fullscreen-dialog";

export function TablePreviewDialog({
  children,
  onClose,
  title,
}: {
  /** 正文里那张表的行内容（thead / tbody），原样搬到弹层里再渲染一次 */
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const { t } = useTranslation();

  return (
    <FullscreenDialog
      description={t("表格全屏预览：表格自己横向滚动")}
      onClose={onClose}
      title={title}
    >
      <div className="min-h-0 overflow-auto p-4">
        <div className="md-content">
          {/* 正文里的 children 是 thead / tbody，表格元素得在这里补上 */}
          <table>{children}</table>
        </div>
      </div>
    </FullscreenDialog>
  );
}
