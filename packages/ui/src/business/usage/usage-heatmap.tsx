/**
 * Token 活动热力图：日历网格 + 月份轴，可切「每日 / 每周 / 累计」。
 *
 * 网格手写（CSS 网格，一列一周、一行一天），悬停/聚焦时用自绘浮层给出「某日 · N token · M 轮消息」；
 * 颜色只取 chart token 的五档深浅，不用图表库。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { UsageDayBucket, UsageWeekBucket } from "../../lib/types";
import { formatTokens } from "../../lib/usage";
import {
  buildCalendar,
  dateKeyOfIndex,
  dayIndexOf,
  type HeatCell,
  type HeatMode,
} from "../../lib/usage-series";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { UsageEmpty, UsageSection } from "./usage-section";
import { type HoverTip, UsageTip } from "./usage-tip";

/** 一周七天的固定顺序，作为网格的行标识（只有周一 / 周三 / 周五在左侧标出） */
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** 行标签：只标出周一 / 周三 / 周五，其余留空避免噪音 */
const weekdayLabelOf = (key: WeekdayKey, t: TFunction): string => {
  switch (key) {
    case "mon":
      return t("周一");
    case "wed":
      return t("周三");
    case "fri":
      return t("周五");
    default:
      return "";
  }
};

/** 五档深浅：0 档是「无活动」，其余用同一色相叠透明 */
const HEAT_CLASS: ReadonlyArray<string> = [
  "bg-muted",
  "bg-chart-2 opacity-25",
  "bg-chart-2 opacity-45",
  "bg-chart-2 opacity-70",
  "bg-chart-2",
];

/** 一格的文案：日期与用量，同时用作悬停提示与无障碍名称 */
const cellTextOf = (cell: HeatCell, t: TFunction): string =>
  t("{{date}} · {{tokens}} token · {{messages}} 轮消息", {
    date: t("{{month}} 月 {{day}} 日", {
      month: Number(cell.date.slice(5, 7)),
      day: Number(cell.date.slice(8, 10)),
    }),
    tokens: formatTokens(cell.value),
    messages: cell.messages,
  });

type UsageHeatmapProps = {
  daily: UsageDayBucket[];
  weekly: UsageWeekBucket[];
};

export function UsageHeatmap({ daily, weekly }: UsageHeatmapProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<HeatMode>("day");
  const [tip, setTip] = useState<HoverTip | null>(null);
  const calendar = useMemo(() => buildCalendar(daily, weekly, mode), [daily, weekly, mode]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** 键盘焦点所在的那一天：网格只留一个格子可 Tab 到，方向键在网格内移动 */
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const byDate = useMemo(() => new Map(daily.map((day) => [day.date, day])), [daily]);
  const lastDate = daily[daily.length - 1]?.date ?? null;
  // 记住的日期可能已不在当前区间（切了时间范围），落回最后一天
  const activeDate = focusDate && byDate.has(focusDate) ? focusDate : lastDate;

  /** 焦点移动：`days` 为 ±1 是上下一天，±7 是左右一周 */
  const moveFocus = (from: string, days: number): void => {
    const target = dateKeyOfIndex(dayIndexOf(from) + days);
    if (!byDate.has(target)) return;
    setFocusDate(target);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus();
  };

  const options = [
    { value: "day", label: t("每日") },
    { value: "week", label: t("每周") },
    { value: "total", label: t("累计") },
  ] as const satisfies ReadonlyArray<SegmentedOption<HeatMode>>;

  /** 浮层贴在格子上沿中间；第一二行改向下展开，免得顶到滚动容器外 */
  const showTip = (cell: HeatCell, row: number, element: HTMLElement): void => {
    setTip({
      x: element.offsetLeft + element.offsetWidth / 2,
      y: element.offsetTop,
      below: row < 2,
      text: cellTextOf(cell, t),
    });
  };

  const empty = calendar.columns.length === 0 || calendar.max === 0;

  return (
    <UsageSection
      title={t("Token 活动")}
      action={
        <SegmentedControl
          label={t("Token 活动")}
          value={mode}
          options={options}
          onChange={setMode}
        />
      }
    >
      {empty ? (
        <UsageEmpty text={t("当前区间暂无可用量数据")} />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: 只作悬停命中区，真正的交互是格子本身
        <div className="relative w-fit" ref={gridRef} onMouseLeave={() => setTip(null)}>
          <div className="flex gap-[3px] pl-7 text-[10px] leading-4 text-muted-foreground">
            {calendar.columns.map((column) => (
              <span key={column.weekStart} className="w-4 shrink-0 whitespace-nowrap">
                {column.month ? t("{{month}} 月", { month: column.month }) : ""}
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <div className="flex w-5 flex-col gap-[3px] text-[10px] text-muted-foreground">
              {WEEKDAY_KEYS.map((key) => (
                <span key={key} className="flex h-4 items-center whitespace-nowrap">
                  {weekdayLabelOf(key, t)}
                </span>
              ))}
            </div>

            <div className="flex gap-[3px]">
              {calendar.columns.map((column) => (
                <div key={column.weekStart} className="flex flex-col gap-[3px]">
                  {WEEKDAY_KEYS.map((key, row) => {
                    const cell = column.cells[row];
                    if (!cell) return <span key={key} aria-hidden className="size-4 rounded-sm" />;
                    return (
                      <button
                        key={key}
                        type="button"
                        data-date={cell.date}
                        tabIndex={cell.date === activeDate ? 0 : -1}
                        aria-label={cellTextOf(cell, t)}
                        onMouseEnter={(event) => showTip(cell, row, event.currentTarget)}
                        onFocus={(event) => showTip(cell, row, event.currentTarget)}
                        onBlur={() => setTip(null)}
                        onKeyDown={(event) => {
                          const step =
                            event.key === "ArrowUp"
                              ? -1
                              : event.key === "ArrowDown"
                                ? 1
                                : event.key === "ArrowLeft"
                                  ? -7
                                  : event.key === "ArrowRight"
                                    ? 7
                                    : 0;
                          if (step === 0) return;
                          event.preventDefault();
                          moveFocus(cell.date, step);
                        }}
                        className={cn("size-4 rounded-sm", HEAT_CLASS[cell.level])}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1 pl-7 text-[10px] text-muted-foreground">
            <span>{t("少")}</span>
            {HEAT_CLASS.map((className) => (
              <span key={className} className={cn("size-3 rounded-sm", className)} />
            ))}
            <span>{t("多")}</span>
          </div>

          <UsageTip tip={tip} />
        </div>
      )}
    </UsageSection>
  );
}
