/**
 * 工具条 / 操作区里的纯图标按钮：`title` 与 `aria-label` 取同一份文案。
 *
 * 全屏弹层的工具条与表格上方的操作区共用；`pressed` 传了就按开关渲染（`aria-pressed` + 按下态底色，
 * 取法与 diff 工具条的换行开关一致）。
 *
 * 除下面这几个之外的原生 props（含 `ref`）一律透传给 `Button`：本组件常作 Radix `asChild` 的子元素
 * （`TooltipTrigger`），悬停 / 聚焦的事件、`data-state` 与锚点 ref 都是经 props 送到这一层的，
 * 只接收固定几个 prop 会把它们丢掉——表现为 tooltip 悬停不弹、位置也算不出来。
 */
import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button } from "./button";

export function ToolbarIconButton({
  children,
  className,
  label,
  onClick,
  pressed,
  ...props
}: ComponentProps<"button"> & {
  /** `title` 与 `aria-label` 同一份文案 */
  label: string;
  /** 开关型动作的当前状态；普通动作不传，不传时不写 `aria-pressed` */
  pressed?: boolean;
}) {
  return (
    <Button
      {...props}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(pressed && "bg-muted text-foreground", className)}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
