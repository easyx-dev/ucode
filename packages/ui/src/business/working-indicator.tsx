/**
 * 生成中的尾部提示：统一的加载图标 + 「工作中」，后面跟着本轮已经走的时间。
 * 纯前端计时——起点取本轮用户消息的时刻，与完成后页脚里的耗时同源，刷新页面也能接着算。
 *
 * 压缩上下文时改报「正在压缩上下文」且不报耗时：那件事与上一轮提问不在同一段时间轴上。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "../base/spinner";
import { durationLabel } from "../lib/time";

/** 不足一秒不报时间，免得刚发出去就显示个位数毫秒 */
const MIN_VISIBLE_MS = 1000;

/** 生成本身的耗时以秒计，半秒一次的刷新足够让读数不跳阶梯 */
const TICK_MS = 500;

const useElapsedMs = (startedAt?: string): number | undefined => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  return Number.isNaN(start) ? undefined : Math.max(0, now - start);
};

export function WorkingIndicator({
  startedAt,
  compacting,
}: {
  startedAt?: string;
  /** 本轮正在压缩上下文而不是生成：换文案，且不报耗时 */
  compacting?: boolean;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsedMs(compacting ? undefined : startedAt);
  const label = elapsed !== undefined && elapsed >= MIN_VISIBLE_MS ? durationLabel(elapsed) : "";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner />
      {compacting ? t("正在压缩上下文…") : t("工作中")}
      {label ? <span className="tabular-nums">{label}</span> : null}
    </div>
  );
}
