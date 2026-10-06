/** 对话区头部：会话标题、运行态与运行时操作 */
import {
  ChevronLeft,
  CirclePlus,
  FolderOpen,
  Gauge,
  GitFork,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../base/badge";
import { Button } from "../base/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../base/tooltip";
import { sessionTitle } from "../lib/session";
import type { ContextUsage, ModelsResponse, SessionSummary, UsageTotals } from "../lib/types";
import { contextPercent, formatTokens } from "../lib/usage";

type ChatHeaderProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  onReloadModels: () => void;
  onOpenSettings: () => void;
  /** 打开会话的工作目录；还没有会话时不传 */
  onOpenDirectory?: () => void;
  /** 子会话视图返回父会话；主会话不传 */
  onBackToParent?: () => void;
  /** 打开本会话分叉自的源会话 */
  onOpenForkSource?: (sessionId: string) => void;
  /** 源会话名；列表里取不到时退化显示 id */
  forkedFromName?: string | null;
  /** 本会话累计 token 用量；无会话或还没有用量时为 null */
  usage?: UsageTotals | null;
  /** 本会话当前上下文占用；无会话或取不到时为 null，此时回落显示累计用量 */
  context?: ContextUsage | null;
  /** 打开全局使用统计 */
  onOpenUsage?: () => void;
  /** 展开 / 收起侧栏（桌面端常驻，移动端唤出抽屉） */
  onToggleSidebar?: () => void;
  /** 侧栏当前是否收起；决定切换按钮的图标 */
  sidebarCollapsed?: boolean;
  /** 新建任务（顶栏的 + 入口） */
  onNewTask?: () => void;
};

export function ChatHeader({
  session,
  models,
  onReloadModels,
  onOpenSettings,
  onOpenDirectory,
  onBackToParent,
  onOpenForkSource,
  forkedFromName,
  usage,
  context,
  onOpenUsage,
  onToggleSidebar,
  sidebarCollapsed,
  onNewTask,
}: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      {onToggleSidebar ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={t("切换侧边栏")}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      ) : null}
      {onNewTask ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={t("新建任务")}
          onClick={onNewTask}
        >
          <CirclePlus className="size-4" />
        </Button>
      ) : null}
      {session?.parentSessionId && onBackToParent ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={t("返回父会话")}
          onClick={onBackToParent}
        >
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}

      <div className="min-w-0 truncate text-sm font-medium">
        {session ? sessionTitle(session, t("新会话")) : t("未选择会话")}
      </div>

      {session?.parentSessionId ? (
        <Badge variant="secondary" className="shrink-0">
          {t("子会话")}
        </Badge>
      ) : null}
      {session?.forkedFromId && onOpenForkSource ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          title={t("打开源会话")}
          onClick={() => onOpenForkSource(session.forkedFromId as string)}
        >
          <GitFork className="size-3.5" />
          {t("分叉自「{{name}}」", { name: forkedFromName || session.forkedFromId })}
        </Button>
      ) : null}
      {session?.running ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t("生成中")}
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {onOpenUsage && (context || (usage && usage.totalTokens > 0)) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-xs text-muted-foreground tabular-nums hover:text-foreground"
                title={t("使用统计")}
                onClick={onOpenUsage}
              >
                <Gauge className="size-3.5" />
                {context ? `${contextPercent(context)}%` : formatTokens(usage?.totalTokens ?? 0)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("使用统计")}</TooltipContent>
          </Tooltip>
        ) : null}

        {onOpenDirectory ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            title={t("目录")}
            onClick={onOpenDirectory}
          >
            <FolderOpen className="size-3.5" />
            {t("目录")}
          </Button>
        ) : null}

        {models && !models.configured ? (
          <>
            <Badge variant="destructive">{t("未配置模型")}</Badge>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              <Settings2 className="size-4" />
              {t("去设置")}
            </Button>
          </>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReloadModels}
              title={t("重建运行时")}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("丢弃内存会话并按当前配置重建运行时")}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
