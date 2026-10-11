/**
 * 顶部指标卡：区间累计与峰值用量、最长聊天时长、活跃与连续天数，以及当前会话的上下文占用。
 *
 * 卡片值随区间变化（`peak` / `longestSessionMs` 来自区间内），连续天数与活跃天数是全量历史口径。
 */
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { ContextUsage, StatsSummaryResponse } from "../../lib/types";
import { contextPercentLabel, formatDuration, formatTokens } from "../../lib/usage";

type UsageMetricsProps = {
  data: StatsSummaryResponse;
  /** 当前会话的上下文占用；没有会话或取不到时为空 */
  context: ContextUsage | null;
};

/** `YYYY-MM-DD` → 「M 月 D 日」 */
const monthDayLabel = (dateKey: string, t: TFunction): string =>
  t("{{month}} 月 {{day}} 日", {
    month: Number(dateKey.slice(5, 7)),
    day: Number(dateKey.slice(8, 10)),
  });

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-xs text-foreground-subtle">{label}</div>
      <div className="mt-0.5 text-lg font-medium tabular-nums">{value}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-foreground-subtle tabular-nums">
        {hint ?? ""}
      </div>
    </div>
  );
}

export function UsageMetrics({ data, context }: UsageMetricsProps) {
  const { t } = useTranslation();
  const peak = data.peak;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <MetricCard
        label={t("累计 token")}
        value={formatTokens(data.total.totalTokens)}
        hint={t("工具调用 {{value}} 次", { value: data.toolCalls })}
      />
      <MetricCard
        label={t("峰值 token")}
        value={peak ? formatTokens(peak.totalTokens) : "—"}
        hint={peak ? monthDayLabel(peak.date, t) : undefined}
      />
      <MetricCard
        label={t("最长聊天时长")}
        value={data.longestSessionMs > 0 ? formatDuration(data.longestSessionMs, t) : "—"}
      />
      <MetricCard
        label={t("当前连续天数")}
        value={t("{{value}} 天", { value: data.streak.current })}
      />
      <MetricCard
        label={t("最长连续天数")}
        value={t("{{value}} 天", { value: data.streak.longest })}
        hint={t("活跃 {{value}} 天", { value: data.streak.activeDays })}
      />
      {context ? (
        <MetricCard
          label={t("当前会话上下文占用")}
          value={contextPercentLabel(context)}
          hint={
            context.estimated
              ? t("估算 · {{used}} / {{window}} token", {
                  used: formatTokens(context.tokens),
                  window: formatTokens(context.contextWindow),
                })
              : t("{{used}} / {{window}} token", {
                  used: formatTokens(context.tokens),
                  window: formatTokens(context.contextWindow),
                })
          }
        />
      ) : null}
    </div>
  );
}
