/**
 * 使用统计仪表盘：全屏面板，指标卡 + Token 活动热力图 + 每日趋势与模型用量 + 按会话明细。
 *
 * 取代原先的统计弹窗——弹窗放不下日历热力图与趋势图，窄屏尤其局促；面板复用设置界面的
 * 全屏取法，入口（`usageOpen`）不变。时间范围在面板内切换，切换只重新取一次数。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../base/dialog";
import { Spinner } from "../../base/spinner";
import { useUsage } from "../../hooks/use-usage";
import type { ContextUsage } from "../../lib/types";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { UsageModelUsage, UsageSessionList } from "./usage-breakdown";
import { UsageHeatmap } from "./usage-heatmap";
import { UsageMetrics } from "./usage-metrics";
import { UsageEmpty } from "./usage-section";
import { UsageTrendChart } from "./usage-trend-chart";

type RangeValue = "30" | "7";

const DAYS_OF: Record<RangeValue, number> = { "30": 30, "7": 7 };

type UsagePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 从统计里打开某个会话 */
  onOpenSession: (sessionId: string) => void;
  /** 当前会话的上下文占用；没有会话或取不到时为空 */
  context?: ContextUsage | null;
};

export function UsagePanel({ open, onOpenChange, onOpenSession, context }: UsagePanelProps) {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeValue>("30");
  const { data, loading, error } = useUsage(open, DAYS_OF[range]);

  const options = [
    { value: "30", label: t("最近 30 天") },
    { value: "7", label: t("最近 7 天") },
  ] as const satisfies ReadonlyArray<SegmentedOption<RangeValue>>;

  const openSession = (sessionId: string): void => {
    onOpenSession(sessionId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        DialogContent 的定位与尺寸由基础类给出（居中 + max-w-sm），全屏要逐项覆盖，
        同属性类的生成顺序不可靠，故关键项一律加 `!`。
      */}
      <DialogContent className="top-0! left-0! h-dvh! w-screen! max-w-none! translate-x-0! translate-y-0! gap-0! rounded-none! bg-background! p-0! text-foreground! ring-0! sm:max-w-none! data-open:zoom-in-100!">
        <DialogTitle className="sr-only">{t("使用统计")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("从本机会话记录汇总的 token 用量；不含模型成本，子会话与分叉会话一并计入。")}
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border pr-12 pl-4 md:pl-8">
            <h2 className="font-heading text-base font-medium">{t("使用统计")}</h2>
            <div className="ml-auto flex items-center gap-2">
              {loading ? <Spinner className="size-icon-base text-foreground-subtle" /> : null}
              <SegmentedControl
                label={t("使用统计")}
                value={range}
                options={options}
                onChange={setRange}
              />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              <p className="text-xs text-foreground-subtle">
                {t("从本机会话记录汇总的 token 用量；不含模型成本，子会话与分叉会话一并计入。")}
              </p>

              {loading && !data ? (
                <div className="flex items-center gap-2 py-8 text-sm text-foreground-subtle">
                  <Spinner className="size-icon-base" />
                  {t("加载中…")}
                </div>
              ) : null}
              {error ? <p className="py-4 text-sm text-destructive">{error}</p> : null}

              {data ? (
                data.streak.activeDays === 0 ? (
                  <UsageEmpty text={t("还没有可展示的数据")} />
                ) : (
                  <>
                    <UsageMetrics data={data} context={context ?? null} />
                    <UsageHeatmap daily={data.daily} weekly={data.weekly} />
                    <div className="grid gap-4 lg:grid-cols-2">
                      <UsageTrendChart daily={data.daily} />
                      <UsageModelUsage items={data.byModel} />
                    </div>
                    <UsageSessionList items={data.bySession} onOpen={openSession} />
                  </>
                )
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
