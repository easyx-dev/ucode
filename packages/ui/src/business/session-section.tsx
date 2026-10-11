/** 侧栏顶层分类（项目 / 助理）：可折叠的组头 + 组内容 */

import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";

type SessionSectionProps = {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 分类右侧的操作区（如新建会话） */
  actions?: ReactNode;
  children: ReactNode;
};

export function SessionSection({
  title,
  collapsed,
  onCollapsedChange,
  actions,
  children,
}: SessionSectionProps) {
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
      <div className="group flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="truncate text-sm text-foreground-subtle">{title}</span>
            <ChevronRight
              className={cn(
                "size-icon-sm shrink-0 text-foreground-subtle transition-transform",
                !collapsed && "rotate-90",
              )}
            />
          </button>
        </CollapsibleTrigger>
        {/* 操作入口悬停 / 聚焦分类行时才露出，触屏上没有悬停态故常驻 */}
        <span className="pointer-events-none flex shrink-0 items-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100">
          {actions}
        </span>
      </div>

      <CollapsibleContent>
        <div className="space-y-0.5 pb-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
