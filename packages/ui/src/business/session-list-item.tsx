/**
 * 会话列表的一行：未读点 / 置顶标记、标题与相对时间；
 * 悬停时右侧露出置顶与归档入口，双击标题可重命名。主会话行可下钻子会话。
 */
import type { SessionSummary } from "@ucode/contracts";
import { cn } from "cn";
import { Archive, Bot, ChevronRight, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Spinner } from "../base/spinner";
import { sessionTitle } from "../lib/session";
import { relativeTimeLabel } from "../lib/time";

type SessionListItemProps = {
  session: SessionSummary;
  /** 当前选中会话 id；子会话行据此高亮 */
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  /** 子会话行：缩进一级，只点选，没有展开与操作 */
  child?: boolean;
  /** 距上次打开之后有新更新 */
  unread?: boolean;
  /** 置顶开关入口（主会话行） */
  onTogglePin?: () => void;
  /** 双击标题重命名入口 */
  onRename?: () => void;
  onArchive?: () => void;
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
  unread,
  onTogglePin,
  onRename,
  onArchive,
  expandable,
  expanded,
  onToggleExpand,
  childSessions,
  childLoading,
}: SessionListItemProps) {
  const { t } = useTranslation();
  const active = session.id === activeId;
  const pinned = Boolean(session.pinnedAt);
  const title = sessionTitle(session, t("新会话"));
  const hasActions = Boolean(onTogglePin && onArchive);

  return (
    <div>
      <div
        className={cn(
          "group relative flex h-10 items-center rounded-lg pr-1 pl-2 transition-colors",
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
        ) : null}

        <button
          type="button"
          title={title}
          className="flex min-w-0 flex-1 items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => onSelect(session.id)}
          onDoubleClick={onRename}
        >
          {/* 固定槽位：有没有指示器都占同样宽度，标题才能与父级文字稳定对齐；置顶针与未读点可并存 */}
          <span className="flex w-6 shrink-0 items-center justify-center gap-1">
            {session.running ? (
              <Spinner className="size-3 text-muted-foreground" />
            ) : child ? (
              <Bot className="size-3 text-muted-foreground" />
            ) : (
              <>
                {pinned ? <Pin className="size-3 text-muted-foreground" /> : null}
                {unread ? (
                  <span
                    className="size-1.5 rounded-full bg-info"
                    role="status"
                    aria-label={t("未读")}
                  />
                ) : null}
              </>
            )}
          </span>
          <span className={cn("truncate", child ? "text-xs" : "text-sm")}>{title}</span>
        </button>

        <span className="shrink-0 pl-1 text-xs text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(pointer:coarse)]:hidden">
          {relativeTimeLabel(session.updatedAt)}
        </span>

        {hasActions ? (
          <div className="pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title={pinned ? t("取消置顶") : t("置顶")}
              onClick={onTogglePin}
            >
              <Pin className={cn("size-3.5", pinned && "fill-current")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title={t("归档")}
              onClick={onArchive}
            >
              <Archive className="size-3.5" />
            </Button>
          </div>
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
