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
      <div className="flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="truncate text-sm text-muted-foreground">{title}</span>
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                !collapsed && "rotate-90",
              )}
            />
          </button>
        </CollapsibleTrigger>
        {actions}
      </div>

      <CollapsibleContent>
        <div className="space-y-0.5 pb-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
