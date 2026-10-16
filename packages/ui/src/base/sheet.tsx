import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

/** 抽屉式弹层：复用 Dialog 原语，从左侧或右侧滑入（移动端侧栏与工作台面板用）
 *
 * 窄屏下铺满屏幕宽度：抽屉里放的是列表与编辑器，留一条窄缝只会白白挤掉内容。
 */
function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetContent({
  className,
  children,
  title,
  side = "left",
  surface = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** 无障碍标题；抽屉由调用方给出本地化文案 */
  title: string;
  /** 滑入方向；左侧用于会话侧栏，右侧用于工作台面板 */
  side?: "left" | "right";
  /**
   * 用实色面板底而不是玻璃面。
   *
   * 玻璃面是「外壳与侧栏」的底色（见 DESIGN.md「分层」），它压在内容之上会透出下层内容；
   * 移动端的工作台是铺满屏幕的主面板（不是浮在对话上的抽屉），透出来就成了观感上的半透明。
   */
  surface?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-overlay duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        // 只留入场动画：退场若用 `data-closed:animate-out`，Radix Presence 会在动画结束前一直挂着节点
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-full flex-col shadow-dialog outline-none",
          surface ? "bg-surface" : "bg-glass supports-backdrop-filter:backdrop-blur-sm",
          "data-open:animate-in",
          side === "left"
            ? "left-0 border-r border-border data-open:slide-in-from-left"
            : "right-0 border-l border-border data-open:slide-in-from-right",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetContent };
