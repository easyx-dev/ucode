/** 用量明细两块：按模型的占比条（带缓存命中率），以及可点击打开的按会话列表 */

import { useTranslation } from "react-i18next";

import { Badge } from "../../base/badge";
import { useModelNames } from "../../hooks/store/use-model-names";
import type { ModelUsage, SessionUsageEntry } from "../../types";
import { formatTokens, usageKindLabel } from "../../utils/usage";
import { cacheHitRate, ratioLabel } from "../../utils/usage-series";
import { UsageEmpty, UsageSection } from "./usage-section";

type UsageModelUsageProps = {
  items: ModelUsage[];
};

export function UsageModelUsage({ items }: UsageModelUsageProps) {
  const { t } = useTranslation();
  const names = useModelNames();
  const max = items.reduce((peak, item) => Math.max(peak, item.totals.totalTokens), 0);

  return (
    <UsageSection title={t("模型用量")}>
      {items.length === 0 ? (
        <UsageEmpty text={t("当前区间暂无可用量数据")} />
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => {
            const rate = cacheHitRate(item.totals);
            return (
              <li key={`${item.provider}/${item.model}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate font-medium">
                      {names.modelName(item.provider, item.model)}
                    </span>
                    <span className="shrink-0 text-foreground-subtle">
                      {names.providerName(item.provider)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                    {/* 不同 provider 的缓存行为差异是这里最有信息量的对比 */}
                    <span className="text-foreground-subtle">
                      {t("命中 {{value}}", { value: ratioLabel(rate) })}
                    </span>
                    <span>{formatTokens(item.totals.totalTokens)}</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{
                      width: `${max > 0 ? (item.totals.totalTokens / max) * 100 : 0}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </UsageSection>
  );
}

type UsageSessionListProps = {
  items: SessionUsageEntry[];
  /** 从统计里打开某个会话 */
  onOpen: (sessionId: string) => void;
};

export function UsageSessionList({ items, onOpen }: UsageSessionListProps) {
  const { t } = useTranslation();

  return (
    <UsageSection title={t("按会话")}>
      {items.length === 0 ? (
        <UsageEmpty text={t("当前区间暂无可用量数据")} />
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.sessionId}>
              <button
                type="button"
                disabled={item.deletedAt !== null}
                onClick={() => onOpen(item.sessionId)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-state-hover disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{item.name || item.sessionId}</span>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {usageKindLabel(item.kind, t)}
                  </Badge>
                  {item.deletedAt ? (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t("已归档")}
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatTokens(item.totals.totalTokens)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </UsageSection>
  );
}
