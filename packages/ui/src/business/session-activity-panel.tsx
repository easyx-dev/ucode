/**
 * 会话活动面板：把「跑着但不在视野里」的三块收进一张只读浮层——子智能体、目标进度、后台服务。
 *
 * 只读聚合：主控不在这里（目标栏常驻输入区上方，面板收起时也要能一眼看到目标在跑），
 * 子会话的完整往来交给现成的小窗。位置、展开与高度由 `session-activity-dock.tsx` 决定。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { Activity, Bot, type LucideIcon, Target, Terminal, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { copyText } from "../lib/clipboard";
import { goalCauseText } from "../lib/goal-text";
import type { GoalTurn } from "../lib/goal-turns";
import type { ActivitySubagentItem, SessionActivityView } from "../lib/session-activity";
import { formatTokens } from "../lib/usage";

/** 高亮定位与「已复制」的停留时长：够看清是哪一条，又不至于一直亮着 */
const NOTICE_MS = 1_600;

const subagentStatusText = (status: ActivitySubagentItem["status"], t: TFunction): string => {
  if (status === "running") return t("执行中");
  return status === "failed" ? t("失败") : t("完成");
};

/** 最近一轮的结论：原因与「下一步」按可用字段拼，两者都空就不铺这一行 */
const outcomeNote = (turn: GoalTurn | null): string =>
  turn?.outcome
    ? [turn.outcome.reason, turn.outcome.nextStep].filter((part) => Boolean(part)).join(" · ")
    : "";

/** 命令的首个词（`pnpm dev` → `pnpm`）：右侧只报「谁在跑」，完整命令在悬停提示里 */
const processName = (command: string): string => command.trim().split(/\s+/)[0] ?? "";

export function SessionActivityPanel({
  activity,
  focusToolCallId,
  maxHeight,
  onOpenSubagent,
  onClose,
}: {
  activity: SessionActivityView;
  /** 从工具行的入口点进来时高亮定位的子智能体 */
  focusToolCallId?: string | null;
  /** 面板高度上限（像素）：按对话区实测高度算，免得向上溢出到内容区头部 */
  maxHeight: number;
  onOpenSubagent: (sessionId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const focusRef = useRef<HTMLLIElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(focusToolCallId ?? null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setHighlighted(focusToolCallId ?? null);
    if (!focusToolCallId) return;
    focusRef.current?.scrollIntoView({ block: "nearest" });
    const timer = setTimeout(() => setHighlighted(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [focusToolCallId]);

  const copyAddress = async (id: string, url: string): Promise<void> => {
    if (!(await copyText(url))) return;
    setCopied(id);
    setTimeout(() => setCopied((current) => (current === id ? null : current)), NOTICE_MS);
  };

  const goal = activity.goal;
  const note = outcomeNote(goal?.latestTurn ?? null);

  return (
    <div
      className="pointer-events-auto flex w-80 max-w-full flex-col overflow-y-auto rounded-xl bg-popover shadow-dialog ring-1 ring-border-strong"
      style={{ maxHeight }}
    >
      <div className="sticky top-0 flex items-center gap-2 border-b border-border bg-popover px-3 py-2">
        <Activity aria-hidden className="size-icon-sm shrink-0 text-foreground-subtle" />
        <span className="shrink-0 text-xs font-medium">{t("会话活动")}</span>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label={t("关闭")}
          className="shrink-0 rounded text-foreground-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onClose}
        >
          <X className="size-icon-sm" />
        </button>
      </div>

      {activity.subagents.length > 0 ? (
        <Section
          icon={Bot}
          title={t("子智能体")}
          extra={`${activity.runningSubagents}/${activity.subagents.length}`}
        >
          <ul className="flex flex-col gap-1">
            {activity.subagents.map((item) => (
              <li
                key={item.toolCallId}
                ref={item.toolCallId === focusToolCallId ? focusRef : undefined}
                className={cn(
                  "rounded-md",
                  item.toolCallId === highlighted && "ring-1 ring-ring/50",
                )}
              >
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => onOpenSubagent(item.sessionId)}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      {item.description || t("子智能体")}
                    </span>
                    <span className="shrink-0 text-foreground-subtle">
                      {subagentStatusText(item.status, t)}
                    </span>
                  </span>
                  {item.latest ? (
                    <span className="truncate text-xs text-foreground-subtlest" title={item.latest}>
                      {item.latest}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {goal ? (
        <Section
          icon={Target}
          title={t("目标")}
          extra={goal.status === "active" ? t("进行中") : goalCauseText(goal.cause, t)}
        >
          <p className="mb-1 line-clamp-2 px-1.5 text-xs" title={goal.objective}>
            {goal.objective}
          </p>
          <div className="flex items-center gap-2 px-1.5 text-xs text-foreground-subtle">
            <span className="shrink-0 tabular-nums">{t("第 {{n}} 轮", { n: goal.turns })}</span>
            <span className="min-w-0 flex-1 truncate tabular-nums">
              {goal.tokenBudget
                ? t("{{used}} / {{budget}} token", {
                    used: formatTokens(goal.tokensUsed),
                    budget: formatTokens(goal.tokenBudget),
                  })
                : t("{{used}} token", { used: formatTokens(goal.tokensUsed) })}
            </span>
          </div>
          {note ? (
            <p className="mt-1 truncate px-1.5 text-xs text-foreground-subtlest" title={note}>
              {note}
            </p>
          ) : null}
        </Section>
      ) : null}

      {activity.services.length > 0 ? (
        <Section icon={Terminal} title={t("后台服务")} extra={String(activity.services.length)}>
          <ul className="flex flex-col gap-0.5">
            {activity.services.map((service) => (
              <li key={service.id} className="flex items-center gap-1.5 px-1.5 py-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground-subtle hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={service.command}
                  onClick={() => void copyAddress(service.id, service.url)}
                >
                  {service.url}
                </button>
                <span className="shrink-0 text-xs text-foreground-subtle">
                  {copied === service.id ? t("已复制") : processName(service.command)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!activity.visible ? (
        <p className="px-3 py-4 text-xs text-foreground-subtle">{t("当前没有进行中的活动")}</p>
      ) : null}
    </div>
  );
}

/** 分段：图标 + 标题 + 右侧计数，内容自己排版 */
function Section({
  icon: Icon,
  title,
  extra,
  children,
}: {
  icon: LucideIcon;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border px-1.5 py-2 first-of-type:border-t-0">
      <div className="mb-1 flex items-center gap-1.5 px-1.5 text-xs text-foreground-subtle">
        <Icon aria-hidden className="size-icon-sm shrink-0" />
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 flex-1" />
        {extra !== undefined ? <span className="shrink-0 tabular-nums">{extra}</span> : null}
      </div>
      {children}
    </section>
  );
}
