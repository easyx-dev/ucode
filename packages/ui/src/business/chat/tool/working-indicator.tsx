/**
 * 生成中的尾部提示：加载图标 + 「工作中」+ 本轮已走的时间，悬停展开本步的分段耗时明细。
 *
 * 行内只报一个数——本轮总耗时（与落定后页脚里的耗时同源）。模型现在在做什么（等响应 / 等首帧 /
 * 生成 / 跑哪个工具 / 在等用户）以及本步四段的读数都收进浮层：与总耗时并排摆着，那两个数看着
 * 像同一件事，读者得先分辨才能读出意思。
 *
 * 计时是纯前端——起点取帧到达与本轮用户消息的时刻，刷新页面也能接着算。
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

/**
 * 浮层里工具段的文案：正跑着就报工具名（一眼看出卡在哪个工具），跑完只报汇总。
 * 工具名对不上的（未登记的 MCP 工具等）由 `toolTitleOf` 回落成原名。
 */
const toolRowLabelOf = (phase: StreamPhase, t: TFunction): string => {
  if (phase.kind !== "tool") return t("执行工具");
  const names = [...new Set(phase.tools.map((tool) => tool.name))];
  const only = names.length === 1 ? names[0] : undefined;
  if (only) return t("执行 {{name}}", { name: toolTitleOf(only, t) });
  return names.length > 1 ? t("执行 {{count}} 个工具", { count: names.length }) : t("执行工具");
};

/** 浮层里分段的名字：与行内同一套词，工具段另行接上工具名 */
const segmentLabelOf = (key: StepSegmentRow["key"], phase: StreamPhase, t: TFunction): string => {
  switch (key) {
    case "response":
      return t("等待模型响应");
    case "firstToken":
      return t("等待首帧");
    case "streaming":
      return t("生成中");
    case "tool":
      return toolRowLabelOf(phase, t);
  }
};

/**
 * 等用户那一行：正挂起就报「等待权限审批 / 等待你的回答」（这行读数就是已经等了多久），等过了报
 * 「其中等用户」——它在工具段里重叠加过账，不与「本次请求」相加。
 */
const waitRowLabelOf = (phase: StreamPhase, t: TFunction): string => {
  if (!phase.waiting) return t("其中等用户");
  return phase.waiting.kind === "question" ? t("等待你的回答") : t("等待权限审批");
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
  // 行内的读数只有一个：本轮已经走了多久（与落定后页脚里的耗时同源）
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
          {compacting ? t("正在压缩上下文…") : t("工作中")}
          {turnMs !== undefined && turnMs >= MIN_VISIBLE_MS ? (
            <span className="tabular-nums">{durationLabel(turnMs, "second")}</span>
          ) : null}
        </button>
      </TooltipTrigger>
      {phase && detail ? (
        <TooltipContent side="top">
          <div className="flex flex-col gap-1">
            <DetailRow label={t("本次请求")} value={durationLabel(detail.totalMs, "second")} />
            {detail.rows.map((row) => (
              <DetailRow
                key={row.key}
                label={segmentLabelOf(row.key, phase, t)}
                value={durationLabel(row.ms, "second")}
                muted
              />
            ))}
            {detail.userWaitMs > 0 ? (
              <DetailRow
                label={waitRowLabelOf(phase, t)}
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
