import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

/** 抽屉式弹层：复用 Dialog 原语，从左侧或右侧滑入（移动端侧栏与工作台面板用） */
function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetContent({
  className,
  children,
  title,
  side = "left",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** 无障碍标题；抽屉由调用方给出本地化文案 */
  title: string;
  /** 滑入方向；左侧用于会话侧栏，右侧用于工作台面板 */
  side?: "left" | "right";
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
          "fixed inset-y-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-sidebar shadow-lg outline-none",
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
