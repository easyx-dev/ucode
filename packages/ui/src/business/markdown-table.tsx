/**
 * Markdown 表格：去掉 streamdown 自带的外层卡片，宽表自己横向滚动，表格上方给右侧操作区。
 *
 * streamdown 默认把表格套进 `border + bg-background + p-2` 的容器里，而本仓库的 `.md-content table` 已经
 * 自带描边与滚动，两层叠起来就是「卡片套卡片」；所以这里整份替换掉它的 `table` 渲染器，顺手把外层
 * 容器与它的内建控件一起去掉——表格操作改由上面这一行自己提供，以后加操作也加在这里。
 */
import { cn } from "cn";
import { Check, Copy, Download, Maximize2, WrapText } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ExtraProps } from "streamdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "../base/tooltip";
import { useTableWrap } from "../hooks/use-table-wrap";
import { copyText } from "../lib/clipboard";
import { openDialog } from "../lib/dialog";
import { downloadTableCsv, tableToMarkdown } from "../lib/table-export";
import { TablePreviewDialog } from "./table-preview-dialog";
import { ToolbarIconButton } from "./toolbar-icon-button";

/** 复制成功后的提示时长；够看清换了图标，又不至于一直占着「已复制」 */
const COPIED_HINT_MS = 1500;

type MarkdownTableProps = ComponentProps<"table"> & ExtraProps;

/** 操作区里的一枚动作：图标按钮 + tooltip（tooltip 取法同 diff 工具条） */
function TableAction({
  children,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarIconButton label={label} onClick={onClick} pressed={pressed}>
          {children}
        </ToolbarIconButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 复制为 Markdown：成功后图标换对勾并保持片刻（与消息页脚的复制同一套反馈） */
function CopyMarkdownAction({ tableRef }: { tableRef: RefObject<HTMLTableElement | null> }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const label = copied ? t("已复制") : t("复制为 Markdown");

  return (
    <TableAction
      label={label}
      onClick={() => {
        const table = tableRef.current;
        // 失败（剪贴板被占、非安全上下文）静默保持原状，与消息页脚的复制一致
        if (table) void copyText(tableToMarkdown(table)).then(setCopied);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </TableAction>
  );
}

export function MarkdownTable({ children }: MarkdownTableProps) {
  const { t } = useTranslation();
  const { wrap, toggleWrap } = useTableWrap();
  const tableRef = useRef<HTMLTableElement | null>(null);

  const open = (): void => {
    void openDialog((close) => (
      <TablePreviewDialog onClose={() => close()} title={t("表格预览")} wrap={wrap}>
        {children}
      </TablePreviewDialog>
    ));
  };

  return (
    <div className="group/table w-fit max-w-full">
      {/* 表格级操作的统一落点，后续表格操作都加在这一行；高度常驻，免得悬停时顶动下方内容 */}
      <div className="mb-1 flex min-h-7 items-center justify-end gap-1 opacity-0 transition focus-within:opacity-100 group-hover/table:opacity-100">
        <TableAction label={t("自动换行")} onClick={toggleWrap} pressed={wrap}>
          <WrapText />
        </TableAction>
        <CopyMarkdownAction tableRef={tableRef} />
        <TableAction
          label={t("导出 CSV")}
          onClick={() => {
            if (tableRef.current) downloadTableCsv(tableRef.current, t("表格"));
          }}
        >
          <Download />
        </TableAction>
        <TableAction label={t("全屏查看")} onClick={open}>
          <Maximize2 />
        </TableAction>
      </div>
      {/* 换行由 `md-table-wrap` 打开（默认不换行，见 styles/markdown.css） */}
      <table className={cn(wrap && "md-table-wrap")} ref={tableRef}>
        {children}
      </table>
    </div>
  );
}
