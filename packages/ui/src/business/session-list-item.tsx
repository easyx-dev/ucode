/** 会话列表的一行：标题、相对时间与重命名 / 归档入口；主会话行可下钻子会话 */
import type { SessionSummary } from "@ucode/contracts";
import { cn } from "cn";
import { Bot, ChevronRight, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../base/dropdown-menu";
import { sessionTitle } from "../lib/session";
import { relativeTimeLabel } from "../lib/time";

type SessionListItemProps = {
  session: SessionSummary;
  /** 当前选中会话 id；子会话行据此高亮 */
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  /** 子会话行：缩进一级，只点选，没有展开与操作菜单 */
  child?: boolean;
  /** 主会话行的重命名 / 归档入口 */
  onRename?: () => void;
  onDelete?: () => void;
  /** 主会话行有子会话时显示展开箭头（搜索期间不展示） */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  childSessions?: SessionSummary[];
  childLoading?: boolean;
};

/** 子会话行递归复用本组件，但 v1 子会话不能再派子智能体，故只有一层 */
export function SessionListItem({
  session,
  activeId,
  onSelect,
  child,
  onRename,
  onDelete,
  expandable,
  expanded,
  onToggleExpand,
  childSessions,
  childLoading,
}: SessionListItemProps) {
  const { t } = useTranslation();
  const active = session.id === activeId;
  const hasActions = Boolean(onRename && onDelete);

  return (
    <div>
      <div
        className={cn(
          "group relative flex h-9 items-center rounded-lg pr-1 pl-2 transition-colors",
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          child && "ml-5",
        )}
      >
        {expandable ? (
          <button
            type="button"
            title={expanded ? t("收起子会话") : t("展开子会话")}
            className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={onToggleExpand}
          >
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : child ? (
          <Bot className="mr-1 size-3 shrink-0 text-muted-foreground" />
        ) : null}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => onSelect(session.id)}
        >
          {session.running ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <span className={cn("truncate", child ? "text-xs" : "text-sm")}>
            {sessionTitle(session, t("新会话"))}
          </span>
        </button>

        <span className="shrink-0 pl-1 text-xs text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          {relativeTimeLabel(session.updatedAt)}
        </span>

        {hasActions ? (
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
        ) : null}
      </div>

      {expandable && expanded ? (
        <div className="space-y-0.5">
          {childLoading && (childSessions?.length ?? 0) === 0 ? (
            <p className="ml-7 py-1 text-xs text-muted-foreground">{t("加载中…")}</p>
          ) : (childSessions?.length ?? 0) === 0 ? (
            <p className="ml-7 py-1 text-xs text-muted-foreground">{t("无子会话")}</p>
          ) : (
            childSessions?.map((item) => (
              <SessionListItem
                key={item.id}
                session={item}
                activeId={activeId}
                onSelect={onSelect}
                child
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
