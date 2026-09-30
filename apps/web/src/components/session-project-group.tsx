/** 会话列表的一个目录分组：可折叠的组头 + 组内会话 / 空态 */
import { ChevronRight, Folder, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SessionListItem } from "@/components/session-list-item";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { SessionSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type SessionProjectGroupProps = {
  name: string;
  /** 项目目录；助理区平铺时为 null */
  path: string | null;
  sessions: SessionSummary[];
  activeId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelect: (sessionId: string) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
  /** 在组内新建会话（在该目录里开一个会话） */
  onCreate: () => void;
};

export function SessionProjectGroup({
  name,
  path,
  sessions,
  activeId,
  collapsed,
  onCollapsedChange,
  onSelect,
  onRename,
  onDelete,
  onCreate,
}: SessionProjectGroupProps) {
  const { t } = useTranslation();

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
      <div className="flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            title={path ?? undefined}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                !collapsed && "rotate-90",
              )}
            />
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs font-medium">{name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{sessions.length}</span>
          </button>
        </CollapsibleTrigger>

        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          title={t("新建会话")}
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="mt-0.5 space-y-0.5 pb-1 pl-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("暂无会话")}</p>
          ) : (
            sessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={() => onSelect(session.id)}
                onRename={() => onRename(session)}
                onDelete={() => onDelete(session)}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
