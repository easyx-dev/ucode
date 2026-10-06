/**
 * 每日 Token 趋势：手写 SVG 的面积 + 折线，悬停给出当日的 token 与轮次。
 *
 * 视图坐标固定 0-100 再靠 `preserveAspectRatio="none"` 铺满容器，因此 SVG 内不放文字
 * （会被拉变形），最大值与日期标签都用 HTML 排在图表外；描边用 `non-scaling-stroke` 保持粗细。
 */
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { UsageDayBucket } from "../../lib/types";
import { formatTokens } from "../../lib/usage";
import { UsageEmpty, UsageSection } from "./usage-section";
import { type HoverTip, UsageTip } from "./usage-tip";

/** 折线在视图里的上下留白（百分比），避免描边贴边被裁 */
const PAD_TOP = 6;
const PAD_BOTTOM = 6;

const dayTextOf = (day: UsageDayBucket, t: TFunction): string =>
  t("{{date}} · {{tokens}} token · {{messages}} 轮消息", {
    date: t("{{month}} 月 {{day}} 日", {
      month: Number(day.date.slice(5, 7)),
      day: Number(day.date.slice(8, 10)),
    }),
    tokens: formatTokens(day.totals.totalTokens),
    messages: day.messages,
  });

type UsageTrendChartProps = {
  daily: UsageDayBucket[];
};

type TrendHover = {
  index: number;
  tip: HoverTip;
};

export function UsageTrendChart({ daily }: UsageTrendChartProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<TrendHover | null>(null);

  const max = daily.reduce((peak, day) => Math.max(peak, day.totals.totalTokens), 0);
  const count = daily.length;
  const first = daily[0];
  const last = daily[count - 1];
  const empty = count === 0 || max === 0;

  const xOf = (index: number): number => (count <= 1 ? 50 : (index / (count - 1)) * 100);
  const yOf = (value: number): number =>
    PAD_BOTTOM + (1 - value / max) * (100 - PAD_TOP - PAD_BOTTOM);

  const points = daily
    .map((day, index) => `${xOf(index)},${yOf(day.totals.totalTokens)}`)
    .join(" L ");

  const middle = daily[Math.round((count - 1) / 2)];

  /** 悬停按横向比例找最近的一天，浮层坐标换算成容器内的像素 */
  const showTip = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
    const day = daily[index];
    if (!day) return;
    const y = (yOf(day.totals.totalTokens) / 100) * rect.height;
    setHover({
      index,
      tip: {
        x: (xOf(index) / 100) * rect.width,
        y,
        below: y < 40,
        text: dayTextOf(day, t),
      },
    });
  };

  return (
    <UsageSection
      title={t("每日 Token 趋势")}
      hint={empty ? undefined : t("峰值 {{value}} token", { value: formatTokens(max) })}
    >
      {empty || !first || !last ? (
        <UsageEmpty text={t("当前区间暂无可用量数据")} />
      ) : (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 只作鼠标命中区，图表本身是 role="img" */}
          <div
            className="relative h-32 sm:h-40"
            onMouseMove={showTip}
            onMouseLeave={() => setHover(null)}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-full w-full"
              role="img"
              aria-label={t("每日 Token 趋势")}
            >
              {count > 1 ? (
                <path
                  d={`M ${xOf(0)},100 L ${points} L ${xOf(count - 1)},100 Z`}
                  style={{ fill: "var(--chart-1)" }}
                  opacity={0.16}
                />
              ) : null}
              {count > 1 ? (
                <path
                  d={`M ${points}`}
                  fill="none"
                  style={{ stroke: "var(--chart-1)" }}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {hover ? (
                <line
                  x1={xOf(hover.index)}
                  x2={xOf(hover.index)}
                  y1={0}
                  y2={100}
                  style={{ stroke: "var(--chart-1)" }}
                  opacity={0.4}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            <UsageTip tip={hover?.tip ?? null} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>{first.date.slice(5)}</span>
            {count > 2 && middle ? <span>{middle.date.slice(5)}</span> : null}
            <span>{last.date.slice(5)}</span>
          </div>
        </>
      )}
    </UsageSection>
  );
}
