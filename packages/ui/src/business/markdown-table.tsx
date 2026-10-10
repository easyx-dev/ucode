/**
 * Markdown 表格：去掉 streamdown 自带的外层卡片，宽表自己横向滚动，并提供全屏查看。
 *
 * streamdown 默认把表格套进 `border + bg-sidebar + p-2` 的容器里，而本仓库的 `.md-content table` 已经
 * 自带描边与滚动，两层叠起来就是「卡片套卡片」；所以这里整份替换掉它的 `table` 渲染器，顺手把外层
 * 容器与它的内建控件一起去掉（全屏改由下面这个按钮提供）。
 */
import { Maximize2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { ExtraProps } from "streamdown";
import { openDialog } from "../lib/dialog";
import { FullscreenToolbarButton } from "./fullscreen-dialog";
import { TablePreviewDialog } from "./table-preview-dialog";

type MarkdownTableProps = ComponentProps<"table"> & ExtraProps;

export function MarkdownTable({ children }: MarkdownTableProps) {
  const { t } = useTranslation();

  const open = (): void => {
    void openDialog((close) => (
      <TablePreviewDialog onClose={() => close()} title={t("表格预览")}>
        {children}
      </TablePreviewDialog>
    ));
  };

  return (
    <div className="group/table relative w-fit max-w-full">
      <table>{children}</table>
      <FullscreenToolbarButton
        className="absolute top-2 right-2 bg-card/80 opacity-0 backdrop-blur-sm transition group-hover/table:opacity-100 focus-visible:opacity-100"
        label={t("全屏查看")}
        onClick={open}
      >
        <Maximize2 />
      </FullscreenToolbarButton>
    </div>
  );
}
