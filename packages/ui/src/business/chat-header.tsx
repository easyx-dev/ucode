/** 对话区头部：会话标题、运行态与运行时操作 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  ChevronLeft,
  Gauge,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../base/badge";
import { Button } from "../base/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../base/tooltip";
import { sessionTitle } from "../lib/session";
import { type SessionTone, sessionToneOf } from "../lib/session-tone";
import type { ContextUsage, ModelsResponse, SessionSummary, UsageTotals } from "../lib/types";
import { contextPercentLabel } from "../lib/usage";
import { CopyTranscriptAction } from "./copy-transcript-action";

/**
 * 状态底色：淡色一层铺满头部并呼吸。只用语义 token，透明度取白名单档位；
 * 呼吸是纯 opacity 动画，减弱动效偏好下由 `base.css` 一律关掉。
 */
const TONE_CLASS: Record<SessionTone, string> = {
  busy: "bg-primary/10",
  form: "bg-warning/10",
  permission: "bg-destructive/10",
};

/** 状态的无障碍文案：底色只对看得见的人有效，读屏与色盲用户靠这一行 */
const toneLabelOf = (t: TFunction, tone: SessionTone): string => {
  switch (tone) {
    case "busy":
      return t("生成中");
    case "form":
      return t("等待你的输入");
    case "permission":
      return t("等待权限审批");
  }
};

type ChatHeaderProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  onReloadModels: () => void;
  onOpenSettings: () => void;
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
  /**
   * 无标题栏窗口顶部那条的高度（px）：> 0 时这一行就是标题条，整行可拖（内部控件自动排除）
   */
  titleBarInset?: number;
  /**
   * 自绘窗口控件的横向占位宽度（px，仅无标题栏窗口需要）：侧栏收起时它正好落在头部左端，
   * 头部得右移这么多把位置让出来
   */
  windowControlsWidth?: number;
  /** 自绘窗口控件的宿主节点：挂在这一行里（这一行就是拖拽区，控件是它的后代才点得动） */
  windowControls?: ReactNode;
  /** 展开工作台（右侧第三栏）；移动端唤出抽屉 */
  onToggleWorkbench?: () => void;
  /** 工作台当前是否展开 */
  workbenchOpen?: boolean;
  /** 双击标题就地改名；子会话等不可改名的场景不传 */
  onRenameSession?: () => void;
  /** 本端是否正在接流：服务端状态还没跟上时用它点亮「生成中」底色 */
  streaming?: boolean;
  /** 取本会话的原始记录（JSONL 文本）用于复制；不传则不显示这个入口 */
  onLoadTranscript?: () => Promise<string>;
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
  onBackToParent,
  onOpenForkSource,
  forkedFromName,
  usage,
  context,
  onOpenUsage,
  onToggleSidebar,
  sidebarCollapsed,
  titleBarInset = 0,
  windowControlsWidth = 0,
  windowControls,
  onToggleWorkbench,
  workbenchOpen,
  onRenameSession,
  streaming = false,
  onLoadTranscript,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const tone = sessionToneOf(session?.status ?? "idle", streaming);

  return (
    <header
      data-slot="chat-header"
      className={cn(
        "relative isolate flex items-center gap-2 border-b border-border px-4 py-2.5",
        // 无标题栏窗口里这行就是标题条：整行可拖（里面的按钮由 `.window-drag button` 排除）
        titleBarInset > 0 && "window-drag",
      )}
      // 让开自绘窗口控件：只在收起侧栏时头部才占据窗口左端（展开时那边是侧栏）
      style={
        sidebarCollapsed && windowControlsWidth > 0
          ? { paddingLeft: windowControlsWidth }
          : undefined
      }
    >
      {/* 状态底色铺在内容之下：头部自身背景透明，负 z 层不会盖住任何东西 */}
      {tone ? (
        <div
          aria-hidden
          data-slot="chat-header-tone"
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 animate-pulse",
            TONE_CLASS[tone],
          )}
        />
      ) : null}
      {windowControls}
      {onToggleSidebar ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={t("切换侧边栏")}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-icon-base" />
          ) : (
            <PanelLeftClose className="size-icon-base" />
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
          <ChevronLeft className="size-icon-base" />
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
          className="h-6 shrink-0 gap-1 px-1.5 text-xs text-foreground-subtle hover:text-foreground"
          title={t("打开源会话")}
          onClick={() => onOpenForkSource(session.forkedFromId as string)}
        >
          <GitFork className="size-icon-sm" />
          {t("分叉自「{{name}}」", { name: forkedFromName || session.forkedFromId })}
        </Button>
      ) : null}
      {tone ? <span className="sr-only">{toneLabelOf(t, tone)}</span> : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {onOpenUsage && (context || (usage && usage.totalTokens > 0)) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-xs text-foreground-subtle tabular-nums hover:text-foreground"
                title={t("使用统计")}
                onClick={onOpenUsage}
              >
                <Gauge className="size-icon-sm" />
                {context ? contextPercentLabel(context) : "—"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {context?.estimated ? t("压缩后为估算值，新一轮回答后回到实测") : t("使用统计")}
            </TooltipContent>
          </Tooltip>
        ) : null}

        {models && !models.configured ? (
          <>
            <Badge variant="destructive">{t("未配置模型")}</Badge>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              <Settings2 className="size-icon-base" />
              {t("去设置")}
            </Button>
          </>
        ) : null}

        {onLoadTranscript ? <CopyTranscriptAction load={onLoadTranscript} /> : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReloadModels}
              title={t("重建运行时")}
            >
              <RefreshCw className="size-icon-sm" />
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
                  <PanelRightClose className="size-icon-base" />
                ) : (
                  <PanelRightOpen className="size-icon-base" />
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
