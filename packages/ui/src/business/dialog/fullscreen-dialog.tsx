/**
 * 全屏查看弹层的外壳：标题、右侧动作区、关闭按钮与铺满一屏的内容区。
 *
 * 图表、表格、图片三种全屏查看共用它——尺寸、圆角与关闭方式只写一处，各自的差异（图表的缩放工具条、
 * 表格与图片的滚动区）由 `actions` 与 children 表达。按本仓库的弹层约定，它是「挂载即打开」的自定义
 * 弹层，由 `openDialog` 调用并负责把 close 交回调用方（见 docs/components.md）。
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../base/dialog";
import { ToolbarIconButton } from "../../base/toolbar-icon-button";

export function FullscreenDialog({
  actions,
  children,
  description,
  onClose,
  title,
}: {
  /** 工具条右侧的自定义动作（如图表的缩放控件）；关闭按钮固定在最后 */
  actions?: ReactNode;
  /** 内容区，自己负责滚动 */
  children: ReactNode;
  /** 读屏说明 */
  description: string;
  onClose: () => void;
  /** 工具条标题，同时作为弹层的可访问名 */
  title: string;
}) {
  const { t } = useTranslation();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // 窄屏铺满（沉浸查看），桌面留一圈边：宽高与圆角都在这里定，不靠外部包裹层
        className="h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-[auto_1fr] gap-0 rounded-none border-0 p-0 sm:h-[86vh] sm:max-h-[86vh] sm:w-[90vw] sm:max-w-none sm:rounded-xl sm:border sm:border-border"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-border border-b px-3">
          <div className="min-w-0 truncate font-medium text-sm">{title}</div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <ToolbarIconButton label={t("关闭预览")} onClick={onClose}>
              <X />
            </ToolbarIconButton>
          </div>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
