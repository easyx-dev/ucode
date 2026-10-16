/**
 * 编辑器里的页面元素节点视图：整段摘要塞进输入框会很难看，这里只显示**一枚芯片**——
 * 「一枚鼠标指针图标 + 元素的可访问名」，悬停给出选择器与所在页面，Backspace 整枚删除。
 *
 * 进消息正文的仍是完整摘要（由方言投影从节点 attrs 里取，见 `pageElementNode`）：
 * 芯片只是给人看的那一面。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { MousePointer2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 芯片样式与附件 token 同档（mono、细边、`rounded-xs`），但用 sans：元素名是界面文案不是路径 */
const CHIP_CLASS =
  "inline-flex max-w-56 items-center gap-1 rounded-xs border border-border bg-background px-1.5 py-0.5 align-baseline text-xs text-foreground [&_svg]:size-icon-xs [&_svg]:shrink-0 [&_svg]:text-foreground-subtle";

export function PageElementChipView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
  const selector = typeof node.attrs.selector === "string" ? node.attrs.selector : "";
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";

  // 悬停说明用原生 title：内容是多行的定位信息，另做弹层反而要处理定位与焦点
  const hint = [
    t("页面元素：{{label}}", { label: label || t("未命名元素") }),
    selector ? `${t("选择器")}：${selector}` : "",
    url ? `${title ? `${title}（${url}）` : url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <NodeViewWrapper as="span" className="inline-block align-baseline">
      <span className={CHIP_CLASS} title={hint} data-page-element="picked">
        <MousePointer2 aria-hidden />
        <span className="min-w-0 truncate">{label || t("未命名元素")}</span>
      </span>
    </NodeViewWrapper>
  );
}
