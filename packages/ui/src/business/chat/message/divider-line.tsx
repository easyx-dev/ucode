/**
 * 对话里的「细线」分隔行：一条压暗的横线 + 文案（可带右侧补充），需要时点开看展开内容。
 *
 * 上下文压缩、合成输入、失败重试、目标完成与目标轮次都用它——它们都不是回答，只是历史里的一个事实，
 * 铺成正常消息会被当成一轮对话读。语义属于消息流，故不进 `base/`，由目标栏的展示件从这里借。
 */
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type DividerLineProps = {
  /** 行文案，如「对话已压缩」 */
  label: string;
  /** 文案右侧的补充（触发来源、轮次…） */
  detail?: string | null;
  /** 展开内容；省略就不是可点开的行 */
  children?: ReactNode;
  /** 展开内容默认是否打开 */
  defaultOpen?: boolean;
  /** 外层类名（如段落间距） */
  className?: string;
};

export function DividerLine({
  className,
  defaultOpen = false,
  detail,
  label,
  children,
}: DividerLineProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = children !== undefined;

  const text = (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{label}</span>
      {detail ? (
        <span className="truncate text-foreground-subtlest" title={detail}>
          {detail}
        </span>
      ) : null}
      {expandable ? (
        <ChevronRight className={cn("size-icon-xs transition-transform", open && "rotate-90")} />
      ) : null}
    </span>
  );

  return (
    <div className={cn("text-xs text-foreground-subtle", className)}>
      {expandable ? (
        <button
          type="button"
          className="group flex w-full items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="h-px flex-1 bg-border" />
          <span className="group-hover:text-foreground">{text}</span>
          <span className="h-px flex-1 bg-border" />
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          {text}
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {expandable && open ? (
        <div className="md-content mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
