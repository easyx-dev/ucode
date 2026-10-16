/**
 * 会话列表的一个项目分组：可折叠的组头（文件夹图标 + 项目名）+ 组内会话 / 空态。
 * 组头本身是拖拽把手（@dnd-kit 的 sortable），拖拽由外层 `SessionProjectGroups` 的上下文提供。
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { Brain, Folder, FolderOpen, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../base/collapsible";
import type { SessionSummary } from "../../types";
import { isSessionUnread } from "./session";
import { SessionPagedRows } from "./session-paged-rows";

type SessionProjectGroupProps = {
  name: string;
  /** 项目目录；既是组头的悬停提示，也是拖拽项 id */
  path: string;
  sessions: SessionSummary[];
  /** 当前选中会话；组内分页至少要展开到它 */
  activeId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 在组内新建会话（在该目录里开一个会话） */
  onCreate: () => void;
  /** 重命名项目（改的是项目展示名，目录本身不动） */
  onRename: () => void;
  /** 记忆开关的生效值（项目覆盖优先，未设过时跟随全局） */
  memoryEnabled: boolean;
  /** 切换项目级记忆开关 */
  onToggleMemory: () => void;
  /** 渲染组内一行；由上层统一带上选中态与子会话下钻数据 */
  renderItem: (session: SessionSummary) => ReactNode;
};

/** 组头悬停才露出的入口：触屏没有悬停态故常驻 */
const ACTION_CLASS =
  "pointer-events-none size-7 shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100";

export function SessionProjectGroup({
  name,
  path,
  sessions,
  activeId,
  collapsed,
  onCollapsedChange,
  onCreate,
  onRename,
  memoryEnabled,
  onToggleMemory,
  renderItem,
}: SessionProjectGroupProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path,
  });
  /** 收起时把组内未读汇总成一个点，展开后由各会话行自报未读 */
  const hasUnread = collapsed && sessions.some(isSessionUnread);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 拖起来的那一组要压住邻居，否则它的卡片会被下一组盖住
      className={cn(isDragging && "relative z-10")}
    >
      <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
        <div className="group flex items-center gap-0.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              title={path}
              // 整个组头就是拖拽把手：移动超过阈值才算拖，单击仍是展开 / 收起
              {...attributes}
              {...listeners}
              className="flex h-10 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
            >
              {collapsed ? (
                <Folder className="size-icon-base shrink-0 text-foreground-subtle" />
              ) : (
                <FolderOpen className="size-icon-base shrink-0 text-foreground-subtle" />
              )}
              <span className="truncate text-sm">{name}</span>
              {hasUnread ? <span className="size-1.5 shrink-0 rounded-full bg-info" /> : null}
            </button>
          </CollapsibleTrigger>

          {/*
            记忆开着时这枚图标常驻（「一眼看出哪些项目开了记忆」），关着时与其他入口一样悬停才现。
            与旁边两个入口同槽位，关着时不用多占位置。
          */}
          <Button
            variant="ghost"
            size="icon"
            className={memoryEnabled ? "size-7 shrink-0" : ACTION_CLASS}
            title={memoryEnabled ? t("关闭项目记忆") : t("开启项目记忆")}
            aria-pressed={memoryEnabled}
            onClick={onToggleMemory}
          >
            <Brain className="size-icon-sm" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={ACTION_CLASS}
            title={t("重命名项目")}
            onClick={onRename}
          >
            <Pencil className="size-icon-sm" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={ACTION_CLASS}
            title={t("新建会话")}
            onClick={onCreate}
          >
            <Plus className="size-icon-base" />
          </Button>
        </div>

        <CollapsibleContent>
          <div className="space-y-0.5 pb-1">
            {sessions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-foreground-subtle">{t("暂无会话")}</p>
            ) : (
              <SessionPagedRows sessions={sessions} activeId={activeId} renderItem={renderItem} />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
