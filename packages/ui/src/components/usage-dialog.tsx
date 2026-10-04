/** 全局使用统计对话框：总量、按模型、按会话与工具调用次数 */
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsage } from "../hooks/use-usage";
import type { ModelUsage, SessionUsageEntry, UsageTotals } from "../lib/types";
import { formatTokens, usageKindLabel } from "../lib/usage";
import { SegmentedControl, type SegmentedOption } from "./segmented-control";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type RangeValue = "all" | "30" | "7";

/** 范围值 → 天数；全部时间不传，服务端按全量统计 */
const daysOf = (range: RangeValue): number | undefined =>
  range === "all" ? undefined : Number(range);

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function TotalsBlock({ totals, toolCalls }: { totals: UsageTotals; toolCalls: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {formatTokens(totals.totalTokens)}
        </span>
        <span className="text-xs text-muted-foreground">{t("合计 token")}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TotalRow label={t("输入")} value={formatTokens(totals.inputTokens)} />
        <TotalRow label={t("输出")} value={formatTokens(totals.outputTokens)} />
        <TotalRow label={t("缓存读")} value={formatTokens(totals.cacheReadTokens)} />
        <TotalRow label={t("缓存写")} value={formatTokens(totals.cacheWriteTokens)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {t("工具调用 {{value}} 次", { value: toolCalls })}
      </div>
    </div>
  );
}

function ModelList({ items }: { items: ModelUsage[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{t("按模型")}</h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={`${item.provider}/${item.model}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              {item.model}
              <span className="ml-1.5 text-xs text-muted-foreground">{item.provider}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatTokens(item.totals.totalTokens)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionList({
  items,
  onOpen,
}: {
  items: SessionUsageEntry[];
  onOpen: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{t("按会话")}</h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.sessionId}>
            <button
              type="button"
              disabled={item.deletedAt !== null}
              onClick={() => onOpen(item.sessionId)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate">{item.name || item.sessionId}</span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {usageKindLabel(item.kind, t)}
                </Badge>
                {item.deletedAt ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t("已归档")}
                  </Badge>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatTokens(item.totals.totalTokens)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type UsageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 从统计里打开某个会话 */
  onOpenSession: (sessionId: string) => void;
};

export function UsageDialog({ open, onOpenChange, onOpenSession }: UsageDialogProps) {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeValue>("all");
  const { data, loading, error } = useUsage(open, daysOf(range));

  const options = [
    { value: "all", label: t("全部时间") },
    { value: "30", label: t("最近 30 天") },
    { value: "7", label: t("最近 7 天") },
  ] as const satisfies ReadonlyArray<SegmentedOption<RangeValue>>;

  const openSession = (sessionId: string): void => {
    onOpenSession(sessionId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("使用统计")}</DialogTitle>
          <DialogDescription>
            {t("从本机会话记录汇总的 token 用量；不含模型成本，子会话与分叉会话一并计入。")}
          </DialogDescription>
        </DialogHeader>

        <SegmentedControl
          label={t("使用统计")}
          value={range}
          options={options}
          onChange={setRange}
        />

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {loading && !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("加载中…")}
            </div>
          ) : null}
          {error ? <p className="py-4 text-sm text-destructive">{error}</p> : null}
          {data ? (
            data.total.totalTokens === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {t("还没有用量记录。")}
              </p>
            ) : (
              <div className="space-y-4 py-1">
                <TotalsBlock totals={data.total} toolCalls={data.toolCalls} />
                <ModelList items={data.byModel} />
                <SessionList items={data.bySession} onOpen={openSession} />
              </div>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
