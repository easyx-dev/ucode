/** 会话列表的一行：标题、相对时间与重命名 / 删除入口 */
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sessionTitle } from "@/lib/session";
import { relativeTimeLabel } from "@/lib/time";
import type { SessionSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type SessionListItemProps = {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
};

export function SessionListItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: SessionListItemProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "group relative flex h-9 items-center rounded-lg pr-1 pl-2 transition-colors",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onSelect}
      >
        {session.running ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <span className="truncate text-sm">{sessionTitle(session, t("新会话"))}</span>
      </button>

      <span className="shrink-0 pl-1 text-xs text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
        {relativeTimeLabel(session.updatedAt)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="pointer-events-none absolute right-0.5 size-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            title={t("更多操作")}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="size-3.5" />
            {t("重命名")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" />
            {t("归档")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
