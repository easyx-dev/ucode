/** 会话列表的一个目录分组：可折叠的组头（文件夹图标 + 项目名）+ 组内会话 / 空态 */

import { Folder, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";
import { isSessionUnread } from "../lib/session";
import type { SessionSummary } from "../lib/types";
import { SessionPagedRows } from "./session-paged-rows";

type SessionProjectGroupProps = {
  name: string;
  /** 项目目录；助理区平铺时为 null */
  path: string | null;
  sessions: SessionSummary[];
  /** 当前选中会话；组内分页至少要展开到它 */
  activeId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 在组内新建会话（在该目录里开一个会话） */
  onCreate: () => void;
  /** 重命名项目（改的是项目展示名，目录本身不动） */
  onRename: () => void;
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
  renderItem,
}: SessionProjectGroupProps) {
  const { t } = useTranslation();
  /** 收起时把组内未读汇总成一个点，展开后由各会话行自报未读 */
  const hasUnread = collapsed && sessions.some(isSessionUnread);

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
      <div className="group flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            title={path ?? undefined}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Folder className="size-icon-base shrink-0 text-foreground-subtle" />
            <span className="truncate text-sm">{name}</span>
            {hasUnread ? <span className="size-1.5 shrink-0 rounded-full bg-info" /> : null}
          </button>
        </CollapsibleTrigger>

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
  );
}
