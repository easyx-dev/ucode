/**
 * 生成中的尾部提示：加载图标 + 当前状态与它已走的时长，悬停展开本步的分段耗时明细。
 *
 * 行内只回答「现在卡在哪、卡了多久」——把本步分段与本轮总耗时并排摆在同一行，两个读数没有主次，
 * 看不出哪个是哪个；明细交给浮层（数据见 `StreamPhase` 与 `stepBreakdown`）。
 *
 * 等用户（审批 / 提问挂起）不换阶段而是换文案，读数变成「等了你多久」：与状态条的口径一致
 * （待答请求优先于生成中），也免得把等用户的时间看成工具慢。
 *
 * 计时是纯前端——起点分别取帧到达与本轮用户消息的时刻，刷新页面也能接着算。
 */
import { type StepSegmentRow, type StreamPhase, stepBreakdown } from "@ucode/sdk";
import { cn } from "cn";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "../../../base/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../base/tooltip";
import { durationLabel } from "../../../utils/time";
import { toolTitleOf } from "./tool-call";

/** 不足一秒不报时间，免得刚发出去就显示个位数毫秒 */
const MIN_VISIBLE_MS = 1000;

/** 读数按秒刷新：活着的读数报整数秒，再快只是让末位数字跳 */
const TICK_MS = 1000;

/** 每一秒给一次当前时刻；没有要计时的东西就不起计时器 */
const useNow = (counting: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);

  return now;
};

/** 已走的时长；起点缺失或非法时不报（负值取 0：起表前后的那一帧还没刷新过 now） */
const elapsedMs = (startedAt: number | string | undefined, now: number): number | undefined => {
  if (startedAt === undefined) return undefined;
  const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  return Number.isNaN(start) ? undefined : Math.max(0, now - start);
};

/** 正在做的事：等用户优先，工具阶段报工具名，并行调用多种时报种类数 */
const phaseLabelOf = (phase: StreamPhase, t: TFunction): string => {
  if (phase.waiting) {
    return phase.waiting.kind === "question" ? t("等待你的回答") : t("等待权限审批");
  }
  switch (phase.kind) {
    case "waitingResponse":
      return t("等待模型响应");
    case "waitingFirstToken":
      return t("等待首帧");
    case "streaming":
      return t("生成中");
    case "tool": {
      const names = [...new Set(phase.tools.map((tool) => tool.name))];
      const only = names.length === 1 ? names[0] : undefined;
      if (only) return t("执行 {{name}}", { name: toolTitleOf(only, t) });
      return names.length > 1 ? t("执行 {{count}} 个工具", { count: names.length }) : t("工作中");
    }
  }
};

/** 浮层里分段的名字：与行内同一套词，只有工具段是汇总（具体工具名在行内报） */
const segmentLabelOf = (key: StepSegmentRow["key"], t: TFunction): string => {
  switch (key) {
    case "response":
      return t("等待模型响应");
    case "firstToken":
      return t("等待首帧");
    case "streaming":
      return t("生成中");
    case "tool":
      return t("执行工具");
  }
};

/** 浮层里的一行：左文案右读数，读数等宽，逐秒变化时左右不会抖 */
function DetailRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", muted && "opacity-80")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function WorkingIndicator({
  startedAt,
  phase,
  compacting,
}: {
  /** 本轮提问的时刻，用来报本轮已走的时长 */
  startedAt?: string;
  /** 正在做什么；为空时退回统一的「工作中」 */
  phase?: StreamPhase | null;
  /** 本轮正在压缩上下文而不是生成：换文案，且不报耗时 */
  compacting?: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow(!compacting && (Boolean(startedAt) || Boolean(phase)));
  // 行内的读数只有一个：当前状态已经走了多久（等用户时就是等了多久）
  const liveMs = compacting
    ? undefined
    : phase
      ? elapsedMs(phase.waiting ? phase.waiting.since : phase.startedAt, now)
      : elapsedMs(startedAt, now);
  const turnMs = compacting ? undefined : elapsedMs(startedAt, now);
  const detail = phase && !compacting ? stepBreakdown(phase, now) : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 用按钮而不是 div：浮层要有一个键盘可达的触发点，a11y 也不允许给非交互元素加 tabIndex */}
        <button
          type="button"
          className="flex w-fit items-center gap-2 text-xs text-foreground-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Spinner />
          {compacting ? t("正在压缩上下文…") : phase ? phaseLabelOf(phase, t) : t("工作中")}
          {liveMs !== undefined && liveMs >= MIN_VISIBLE_MS ? (
            <span className="tabular-nums">{durationLabel(liveMs, "second")}</span>
          ) : null}
        </button>
      </TooltipTrigger>
      {detail ? (
        <TooltipContent side="top">
          <div className="flex flex-col gap-1">
            <DetailRow label={t("本次请求")} value={durationLabel(detail.totalMs, "second")} />
            {detail.rows.map((row) => (
              <DetailRow
                key={row.key}
                label={segmentLabelOf(row.key, t)}
                value={durationLabel(row.ms, "second")}
                muted
              />
            ))}
            {detail.userWaitMs > 0 ? (
              <DetailRow
                label={t("其中等用户")}
                value={durationLabel(detail.userWaitMs, "second")}
                muted
              />
            ) : null}
            {turnMs !== undefined ? (
              <DetailRow label={t("本轮")} value={durationLabel(turnMs, "second")} muted />
            ) : null}
          </div>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
