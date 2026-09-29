/** 会话列表的一行：标题、消息数与模型标记、重命名 / 删除入口 */
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sessionTitle } from "@/lib/session";
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
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <div className="truncate text-xs font-medium">{sessionTitle(session)}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{session.messageCount} 条</span>
          {session.running ? (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="size-2.5 animate-spin" />
              生成中
            </span>
          ) : null}
          {session.model ? (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {session.model.split("/").pop()}
            </Badge>
          ) : null}
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 group-hover:opacity-100"
            title="更多"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="size-3.5" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
