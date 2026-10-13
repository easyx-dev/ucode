/**
 * 步级耗时：服务端从每步耗时记录聚合出的结果（每轮步数、单步耗时分位、首 token 与工具耗时占比、失败步数），
 * 以及按模型 / 按思考档位的分桶对比。
 *
 * 数据来自服务端统计响应里的 `steps`；区间与 token 口径同源（都跟查询的 `days`）。
 * 取不到数的指标一律渲染 `—`：中断轮没有首帧锚点、区间内没有步记录，都不该显示成 0。
 */
import { useTranslation } from "react-i18next";

import type { StatsStepSummary, StepUsageBucket, StepUsageTotals } from "../../lib/types";
import { formatMs, ratioLabel } from "../../lib/usage-series";
import { UsageEmpty, UsageSection } from "./usage-section";

function StepCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

/** 分桶列表：一行「键 + 步数 + 平均步耗时」，用占比条表示步数 */
function StepBucketList({ title, items }: { title: string; items: StepUsageBucket[] }) {
  const { t } = useTranslation();
  const max = items.reduce((peak, item) => Math.max(peak, item.totals.steps), 0);

  return (
    <div className="space-y-2">
      <div className="text-xs text-foreground-subtle">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-foreground-subtle">{t("当前区间暂无步级数据")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium">{item.key}</span>
                <span className="shrink-0 tabular-nums text-foreground-subtle">
                  {t("{{steps}} 步", { steps: item.totals.steps })} ·{" "}
                  {formatMs(item.totals.avgStepMs)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{ width: `${max > 0 ? (item.totals.steps / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 顶部指标：一轮几步、单步多慢、时间花在哪里、有多少步没跑完 */
export function UsageSteps({ steps }: { steps: StatsStepSummary }) {
  const { t } = useTranslation();
  const total: StepUsageTotals = steps.total;
  const firstTokenMs =
    total.avgFirstEventMs === null && total.avgTtftMs === null
      ? null
      : (total.avgFirstEventMs ?? 0) + (total.avgTtftMs ?? 0);

  return (
    <UsageSection
      title={t("步级耗时")}
      hint={
        total.steps === 0
          ? undefined
          : t("{{steps}} 步 · {{turns}} 轮", { steps: total.steps, turns: total.turns })
      }
    >
      {total.steps === 0 ? (
        <UsageEmpty text={t("当前区间暂无步级数据")} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <StepCard
              label={t("每轮步数")}
              value={
                total.stepsPerTurn === null
                  ? "—"
                  : t("{{value}} 步", { value: total.stepsPerTurn.toFixed(1) })
              }
            />
            <StepCard
              label={t("平均步耗时")}
              value={formatMs(total.avgStepMs)}
              hint={t("中位 {{p50}} · P90 {{p90}}", {
                p50: formatMs(total.p50StepMs),
                p90: formatMs(total.p90StepMs),
              })}
            />
            <StepCard
              label={t("首 token 占比")}
              value={ratioLabel(total.ttftShare)}
              hint={t("平均等首帧 {{value}}", { value: formatMs(firstTokenMs) })}
            />
            <StepCard
              label={t("工具耗时占比")}
              value={ratioLabel(total.toolShare)}
              hint={t("已扣掉等用户的时间")}
            />
            <StepCard
              label={t("失败步数")}
              value={String(total.failedSteps)}
              hint={t("上游报错或本轮被中断")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StepBucketList title={t("按模型")} items={steps.byModel} />
            <StepBucketList title={t("按思考档位")} items={steps.byThinking} />
          </div>
        </div>
      )}
    </UsageSection>
  );
}
