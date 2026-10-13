/**
 * 每日趋势：手写 SVG 的面积 + 折线，悬停给出当日的值，可在「Token」与「缓存命中率」两种口径间切换。
 *
 * 视图坐标固定 0-100 再靠 `preserveAspectRatio="none"` 铺满容器，因此 SVG 内不放文字
 * （会被拉变形），最大值与日期标签都用 HTML 排在图表外；描边用 `non-scaling-stroke` 保持粗细。
 * 命中率模式按百分比作图（0-100 即满量程），与 token 模式共用同一套坐标换算。
 */
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl, type SegmentedOption } from "../../base/segmented-control";
import type { StepUsageBucket, UsageDayBucket } from "../../types";
import { formatTokens } from "../../utils/usage";
import { cacheHitRate, formatMs, ratioLabel } from "../../utils/usage-series";
import { UsageEmpty, UsageSection } from "./usage-section";
import { type HoverTip, UsageTip } from "./usage-tip";

/** 折线在视图里的上下留白（百分比），避免描边贴边被裁 */
const PAD_TOP = 6;
const PAD_BOTTOM = 6;

/** 图表的取值口径：累计 token / 当日缓存命中率（百分比）/ 当日平均步耗时（毫秒） */
type TrendMode = "tokens" | "hitRate" | "stepMs";

/** 作图用的一天：`value` 已按模式换算（token 模式是 token 数，命中率模式是 0-100） */
type TrendDay = {
  date: string;
  value: number;
  messages: number;
};

/**
 * 命中率模式下没有输入的那天不给比率，直接不画（零点会把折线拽到 0，看着像「全没命中」）。
 * token 模式则每天都有值。
 */
const seriesOf = (
  daily: ReadonlyArray<UsageDayBucket>,
  steps: ReadonlyArray<StepUsageBucket>,
  mode: TrendMode,
): TrendDay[] => {
  if (mode === "tokens") {
    return daily.map((day) => ({
      date: day.date,
      value: day.totals.totalTokens,
      messages: day.messages,
    }));
  }
  if (mode === "stepMs") {
    // 步级桶按日给的是当天平均每步耗时；没有步的那天不画（零点会把折线拽到底）
    return steps.flatMap((bucket) =>
      bucket.totals.avgStepMs === null
        ? []
        : [{ date: bucket.key, value: bucket.totals.avgStepMs, messages: bucket.totals.steps }],
    );
  }
  return daily.flatMap((day) => {
    const rate = cacheHitRate(day.totals);
    return rate === undefined
      ? []
      : [{ date: day.date, value: rate * 100, messages: day.messages }];
  });
};

const dayTextOf = (day: TrendDay, mode: TrendMode, t: TFunction): string => {
  const date = t("{{month}} 月 {{day}} 日", {
    month: Number(day.date.slice(5, 7)),
    day: Number(day.date.slice(8, 10)),
  });
  if (mode === "hitRate") {
    return t("{{date}} · 命中 {{rate}} · {{messages}} 轮消息", {
      date,
      rate: ratioLabel(day.value / 100),
      messages: day.messages,
    });
  }
  if (mode === "stepMs") {
    return t("{{date}} · 平均每步 {{value}} · {{steps}} 步", {
      date,
      value: formatMs(day.value),
      steps: day.messages,
    });
  }
  return t("{{date}} · {{tokens}} token · {{messages}} 轮消息", {
    date,
    tokens: formatTokens(day.value),
    messages: day.messages,
  });
};

type UsageTrendChartProps = {
  daily: UsageDayBucket[];
  /** 步级按日分桶；用来画「每步耗时」口径 */
  steps: StepUsageBucket[];
};

type TrendHover = {
  index: number;
  tip: HoverTip;
};

export function UsageTrendChart({ daily, steps }: UsageTrendChartProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TrendMode>("tokens");
  const [hover, setHover] = useState<TrendHover | null>(null);

  const options = [
    { value: "tokens", label: t("Token") },
    { value: "hitRate", label: t("命中率") },
    { value: "stepMs", label: t("每步耗时") },
  ] as const satisfies ReadonlyArray<SegmentedOption<TrendMode>>;

  /** 三种口径各自的区块标题（同时用作图表的无障碍名） */
  const trendTitle = (value: TrendMode): string => {
    switch (value) {
      case "tokens":
        return t("每日 Token 趋势");
      case "hitRate":
        return t("每日缓存命中率");
      case "stepMs":
        return t("每日平均步耗时");
    }
  };

  const series = seriesOf(daily, steps, mode);
  const max = series.reduce((peak, day) => Math.max(peak, day.value), 0);
  // 命中率是百分比量纲，满量程固定 100：不按当日最大值拉伸，否则 30% 会被画成触顶
  const scaleMax = mode === "hitRate" ? 100 : max;
  const count = series.length;
  const first = series[0];
  const last = series[count - 1];
  const empty = count === 0 || max === 0;

  const xOf = (index: number): number => (count <= 1 ? 50 : (index / (count - 1)) * 100);
  const yOf = (value: number): number =>
    PAD_BOTTOM + (1 - value / scaleMax) * (100 - PAD_TOP - PAD_BOTTOM);

  const points = series.map((day, index) => `${xOf(index)},${yOf(day.value)}`).join(" L ");

  const middle = series[Math.round((count - 1) / 2)];

  /** 悬停按横向比例找最近的一天，浮层坐标换算成容器内的像素 */
  const showTip = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
    const day = series[index];
    if (!day) return;
    const y = (yOf(day.value) / 100) * rect.height;
    setHover({
      index,
      tip: {
        x: (xOf(index) / 100) * rect.width,
        y,
        below: y < 40,
        text: dayTextOf(day, mode, t),
      },
    });
  };

  const switchMode = (next: TrendMode): void => {
    setMode(next);
    setHover(null);
  };

  return (
    <UsageSection
      title={trendTitle(mode)}
      hint={
        empty
          ? undefined
          : mode === "hitRate"
            ? t("最高 {{value}}", { value: ratioLabel(max / 100) })
            : mode === "stepMs"
              ? t("最慢 {{value}}", { value: formatMs(max) })
              : t("峰值 {{value}} token", { value: formatTokens(max) })
      }
      action={
        <SegmentedControl
          label={t("趋势口径")}
          value={mode}
          options={options}
          onChange={switchMode}
        />
      }
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
              aria-label={trendTitle(mode)}
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
          <div className="mt-1 flex justify-between text-chart-axis text-foreground-subtle tabular-nums">
            <span>{first.date.slice(5)}</span>
            {count > 2 && middle ? <span>{middle.date.slice(5)}</span> : null}
            <span>{last.date.slice(5)}</span>
          </div>
        </>
      )}
    </UsageSection>
  );
}
