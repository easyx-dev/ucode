/**
 * 编辑器里的引用锚点：与页面元素同一套分工——输入框里是一枚**芯片**（短名 + 图标），
 * 进消息正文的是那个锚点（由方言投影从节点 attrs 里取，见 `mentionNode`）。
 *
 * 芯片上不显示锚点原文：`@design:<会话>/<页>/<节点>` 这类串人读不出是什么，插件给的短名才是
 * 用户刚刚在画布 / 面板上点出来的那个东西的名字。悬停时才露出锚点，方便手改或复制。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 与页面元素芯片同一档样式：细边、`rounded-xs`、sans（短名是界面文案不是路径） */
const CHIP_CLASS =
  "inline-flex max-w-56 items-center gap-1 rounded-xs border border-border bg-background px-1.5 py-0.5 align-baseline text-xs text-foreground [&_svg]:size-icon-xs [&_svg]:shrink-0 [&_svg]:text-foreground-subtle";

export function MentionChipView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
  const anchor = typeof node.attrs.anchor === "string" ? node.attrs.anchor : "";

  // 悬停给锚点原文：用户想手改或复制时能直接拿到
  const hint = [t("引用：{{label}}", { label: label || t("未命名引用") }), anchor]
    .filter(Boolean)
    .join("\n");

  return (
    <NodeViewWrapper as="span" className="inline-block align-baseline">
      <span className={CHIP_CLASS} title={hint} data-mention-chip="picked">
        <Link2 aria-hidden />
        <span className="min-w-0 truncate">{label || t("未命名引用")}</span>
      </span>
    </NodeViewWrapper>
  );
}
