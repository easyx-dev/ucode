/**
 * 编辑器里的设计节点：与页面元素同一套分工——输入框里是一枚**芯片**（图层路径 + 画框图标），
 * 进消息正文的是那个锚点（由方言投影从节点 attrs 里取，见 `designNodeNode`）。
 *
 * 为什么芯片上不显示 id：id 形如 `1701918787:3`，人读不出是哪颗节点；图层路径才是用户刚刚在画布上
 * 点出来的那个东西的名字。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 与页面元素芯片同一档样式：细边、`rounded-xs`、sans（图层名是界面文案不是路径） */
const CHIP_CLASS =
  "inline-flex max-w-56 items-center gap-1 rounded-xs border border-border bg-background px-1.5 py-0.5 align-baseline text-xs text-foreground [&_svg]:size-icon-xs [&_svg]:shrink-0 [&_svg]:text-foreground-subtle";

export function DesignNodeChipView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
  const anchor = typeof node.attrs.anchor === "string" ? node.attrs.anchor : "";

  // 悬停给锚点原文：用户想手改或复制时能直接拿到
  const hint = [t("设计节点：{{label}}", { label: label || t("未命名图层") }), anchor]
    .filter(Boolean)
    .join("\n");

  return (
    <NodeViewWrapper as="span" className="inline-block align-baseline">
      <span className={CHIP_CLASS} title={hint} data-design-node="picked">
        <LayoutTemplate aria-hidden />
        <span className="min-w-0 truncate">{label || t("未命名图层")}</span>
      </span>
    </NodeViewWrapper>
  );
}
