/** 对话区头部：会话标题、运行态与运行时操作 */
import {
  ChevronLeft,
  FolderOpen,
  Gauge,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../base/badge";
import { Button } from "../base/button";
import { Spinner } from "../base/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../base/tooltip";
import { sessionTitle } from "../lib/session";
import type { ContextUsage, ModelsResponse, SessionSummary, UsageTotals } from "../lib/types";
import { contextPercentLabel } from "../lib/usage";

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
  /** 本会话累计 token 用量；无会话或还没有用量时为 null（与占用一起决定徽标显不显） */
  usage?: UsageTotals | null;
  /** 本会话当前上下文占用；无会话、没回答过或模型窗口不可知时为 null（徽标此时只显示占位符） */
  context?: ContextUsage | null;
  /** 打开全局使用统计 */
  onOpenUsage?: () => void;
  /** 展开 / 收起侧栏（桌面端常驻，移动端唤出抽屉） */
  onToggleSidebar?: () => void;
  /** 侧栏当前是否收起；决定切换按钮的图标 */
  sidebarCollapsed?: boolean;
  /** 展开工作台（右侧第三栏）；移动端唤出抽屉 */
  onToggleWorkbench?: () => void;
  /** 工作台当前是否展开 */
  workbenchOpen?: boolean;
  /** 双击标题就地改名；子会话等不可改名的场景不传 */
  onRenameSession?: () => void;
};

/**
 * 会话标题：溢出时悬停给全名（没溢出就不挂提示，免得白占一个弹层），双击就地改名。
 * 是否溢出靠实测（`scrollWidth > clientWidth`），窗口缩放与标题变化都要重算。
 */
function SessionTitle({ title, onRename }: { title: string; onRename?: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = (): void => setClipped(node.scrollWidth > node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [title]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          className="min-w-0 truncate text-left text-sm font-medium"
          onDoubleClick={onRename}
        >
          {title}
        </button>
      </TooltipTrigger>
      {clipped ? <TooltipContent>{title}</TooltipContent> : null}
    </Tooltip>
  );
}

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
  onToggleWorkbench,
  workbenchOpen,
  onRenameSession,
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

      <SessionTitle
        title={session ? sessionTitle(session, t("新会话")) : t("未选择会话")}
        onRename={session && onRenameSession ? onRenameSession : undefined}
      />

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
          <Spinner className="size-3" />
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
                {context ? contextPercentLabel(context) : "—"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {context?.estimated ? t("压缩后为估算值，新一轮回答后回到实测") : t("使用统计")}
            </TooltipContent>
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
          <TooltipContent>{t("按当前配置重建运行时，正在生成的会话本轮结束后切换")}</TooltipContent>
        </Tooltip>

        {/* 工作台开关放在最右，与侧栏开关（最左）对称 */}
        {onToggleWorkbench ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={workbenchOpen ? t("收起工作台") : t("打开工作台")}
                onClick={onToggleWorkbench}
              >
                {workbenchOpen ? (
                  <PanelRightClose className="size-4" />
                ) : (
                  <PanelRightOpen className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{workbenchOpen ? t("收起工作台") : t("打开工作台")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}
