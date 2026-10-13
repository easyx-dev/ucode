/**
 * 对话区右上角的悬浮活动入口：有活动才出现，点开在它下方浮出活动面板。
 *
 * 位置与展开都由**右侧留白**（内容列两侧的空白）决定：
 *
 * - 留白够放下面板（≈ 面板宽 + 两侧边距）时，面板整屏落在内容列右侧、不压正文，**默认就展开**；
 * - 留白不够（窄窗口、开着工作台）时只出一条摘要条，**默认收起**，点开才在内容列上浮出。
 *
 * 用户手动收起 / 展开过就按用户的选择（`open` 非 null），不再随窗口宽度翻来覆去。
 * 层级取 `z-10`：低于所有 Portal 弹层；面板高度按对话区实测高度收口，不会顶到内容区头部。
 */
import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionActivityView } from "../lib/session-activity";
import { SessionActivityPanel } from "./session-activity-panel";

/**
 * 右侧留白需要的宽度：面板 `w-80`（20rem）+ 左右各 1rem 的呼吸。
 * 用 rem 而不是像素——界面字号可调，面板宽度也跟着 rem 走。
 */
const SIDE_SPACE_REM = 22;

/** 面板高度的下限：对话区很矮时也留出能看几行的位置 */
const MIN_PANEL_HEIGHT = 160;

/** 面板之外还要让出的高度：顶部间距 + 摘要条一行 + 两者之间的空隙 */
const DOCK_RESERVED_HEIGHT = 64;

type SessionActivityDockProps = {
  activity: SessionActivityView;
  /** 用户对展开态的选择；`null` 表示还没选过——此时按留白是否充足决定 */
  open: boolean | null;
  /** 从工具行的入口点进来时高亮定位的子智能体 */
  focusToolCallId?: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenSubagent: (sessionId: string) => void;
};

export function SessionActivityDock({
  activity,
  open,
  focusToolCallId,
  onOpenChange,
  onOpenSubagent,
}: SessionActivityDockProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** 右侧留白是否够放面板，以及面板能用多高：随窗口、分栏与界面字号变化重算 */
  const [metrics, setMetrics] = useState({ hasRoom: false, maxHeight: MIN_PANEL_HEIGHT });

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const sideSpace = (container.clientWidth - content.clientWidth) / 2;
      setMetrics({
        hasRoom: sideSpace >= SIDE_SPACE_REM * rem,
        maxHeight: Math.max(MIN_PANEL_HEIGHT, container.clientHeight - DOCK_RESERVED_HEIGHT),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // 没有活动就什么都不渲染（哪怕留白够）：默认展开只在「真有事可看」时才成立
  const expanded = open ?? (activity.visible && metrics.hasRoom);
  const parts: string[] = [];
  if (activity.subagents.length > 0) {
    parts.push(t("{{n}} 个子智能体", { n: activity.subagents.length }));
  }
  if (activity.services.length > 0) {
    parts.push(t("{{n}} 个服务", { n: activity.services.length }));
  }
  if (activity.goalActive) parts.push(t("目标进行中"));

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
      {/* 与消息列同宽的空层（`mx-auto max-w-4xl`）：量内容列两侧还剩多少留白。
          这一层要“始终渲染”——量尺寸的 effect 只跑一次，早退成 `null` 会让 ref 挂不上、
          之后再出现活动也不会重新测量（实测：宽屏下默认展开永远不生效） */}
      <div ref={contentRef} aria-hidden className="mx-auto h-full w-full max-w-4xl" />
      {activity.visible || expanded ? (
        <div className="absolute top-2 right-4 flex flex-col items-end gap-2">
          {expanded ? (
            <SessionActivityPanel
              activity={activity}
              focusToolCallId={focusToolCallId}
              maxHeight={metrics.maxHeight}
              onOpenSubagent={onOpenSubagent}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
          {activity.visible ? (
            <button
              type="button"
              aria-expanded={expanded}
              className="pointer-events-auto flex items-center gap-1.5 rounded-xs bg-popover px-2.5 py-1 text-xs text-foreground ring-1 ring-border-strong hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => onOpenChange(!expanded)}
            >
              <Activity aria-hidden className="size-icon-sm shrink-0 text-foreground-subtle" />
              <span className="tabular-nums">
                {parts.length > 0 ? parts.join(" · ") : t("会话活动")}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
