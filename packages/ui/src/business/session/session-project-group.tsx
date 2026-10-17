/**
 * 会话列表的一个项目分组：可折叠的组头（文件夹图标 + 项目名）+ 组内会话 / 空态。
 * 组头本身是拖拽把手（@dnd-kit 的 sortable），拖拽由外层 `SessionProjectGroups` 的上下文提供。
 * 右侧只留「新建会话」与「更多操作」两个入口，重命名与记忆开关都收进菜单，宽度让给项目名。
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { Brain, Folder, FolderOpen, MoreHorizontal, Pencil, Plus, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../base/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../base/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../base/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../base/tooltip";
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
  /** 项目是否显式设过记忆开关；没设过时「跟随全局默认」那个入口不适用 */
  memoryOverridden: boolean;
  /** 切换项目级记忆开关 */
  onToggleMemory: () => void;
  /** 清掉项目级覆盖，回到「跟随全局默认」 */
  onResetMemory: () => void;
  /** 渲染组内一行；由上层统一带上选中态与子会话下钻数据 */
  renderItem: (session: SessionSummary) => ReactNode;
};

/** 组头悬停才露出的入口：触屏没有悬停态故常驻 */
const ACTION_CLASS =
  "pointer-events-none shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100";

/** 菜单触发钮的补充：菜单开着时指针可能已经离开组头，这颗按钮不能跟着消失 */
const MENU_ACTION_CLASS = cn(
  ACTION_CLASS,
  "data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
);

/**
 * 悬停说明等一会儿再出：组头占满侧栏宽度，扫过列表时立刻弹层会一路盖住下面的行。
 * 原生 `title` 大约一秒，取一半；按钮类的即时提示不受影响（它们各挂各的 Tooltip）。
 */
const TOOLTIP_DELAY_MS = 500;

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
  memoryOverridden,
  onToggleMemory,
  onResetMemory,
  renderItem,
}: SessionProjectGroupProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path,
  });
  /** 收起时把组内未读汇总成一个点，展开后由各会话行自报未读 */
  const hasUnread = collapsed && sessions.some(isSessionUnread);
  /** 记忆开着的项目靠这枚图标自报家门：着色是列表里唯一常驻的记忆标记 */
  const folderClass = cn(
    "size-icon-base shrink-0",
    memoryEnabled ? "text-info" : "text-foreground-subtle",
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 拖起来的那一组要压住邻居，否则它的卡片会被下一组盖住
      className={cn(isDragging && "relative z-10")}
    >
      <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
        <div className="group flex items-center gap-0.5">
          <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
            <TooltipTrigger asChild>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  // 整个组头就是拖拽把手：移动超过阈值才算拖，单击仍是展开 / 收起
                  {...attributes}
                  {...listeners}
                  className="flex h-10 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                >
                  {collapsed ? (
                    <Folder className={folderClass} />
                  ) : (
                    <FolderOpen className={folderClass} />
                  )}
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm">{name}</span>
                    {hasUnread ? <span className="size-1.5 shrink-0 rounded-full bg-info" /> : null}
                  </span>
                </button>
              </CollapsibleTrigger>
            </TooltipTrigger>
            {/* 说明兼当目录的兜底：拖拽把手给出的路径就是这一行的身份。
                这条 Tooltip 把本行的 `data-state` 也一并接管了（外层的 Slot 后写），
                折叠态看 `aria-expanded`，别按 `data-state` 判断展开 */}
            <TooltipContent side="right" className="flex-col items-start gap-0.5">
              {memoryEnabled ? <span>{t("此项目已开启记忆")}</span> : null}
              <span className="break-all font-mono">{path}</span>
            </TooltipContent>
          </Tooltip>

          <IconButton className={ACTION_CLASS} label={t("新建会话")} onClick={onCreate}>
            <Plus className="size-icon-base" />
          </IconButton>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* 走 Button + `aria-label` 而不是 IconButton：带 Tooltip 的 IconButton 不是 DOM 节点，
                  外层 Slot 的 props 到不了那颗按钮，菜单点不开 */}
              <Button
                variant="ghost"
                size="icon-sm"
                className={MENU_ACTION_CLASS}
                aria-label={t("更多操作")}
              >
                <MoreHorizontal className="size-icon-base" />
              </Button>
            </DropdownMenuTrigger>
            {/* 宽度默认跟着触发器（28px），这里要放动作文案，放宽到最长的一项放得下 */}
            <DropdownMenuContent align="end" className="w-auto min-w-40">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil className="size-icon-sm" />
                {t("重命名项目")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleMemory}>
                <Brain className="size-icon-sm" />
                {memoryEnabled ? t("关闭项目记忆") : t("开启项目记忆")}
              </DropdownMenuItem>
              {/* 改过之后就与全局脱钩了（全局不会再影响它），所以留一个回去的入口 */}
              {memoryOverridden ? (
                <DropdownMenuItem onSelect={onResetMemory}>
                  <Undo2 className="size-icon-sm" />
                  {t("跟随全局默认")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
