/** 使用统计的展示辅助：token 紧凑格式化、时长文案、上下文占用百分比与会话来源文案 */
import type { TFunction } from "i18next";
import type { ContextUsage, SessionUsageKind } from "./types";
import { durationParts } from "./usage-series";

/** token 数按千 / 百万紧凑显示，如 `12.3k`、`1.2M` */
export const formatTokens = (value: number): string => {
  if (value < 1_000) return String(value);
  // 四舍五入到千位会进位成 1000.0k 的，直接升到 M，避免出现 `1000.0k`
  if (Math.round(value / 1_000) >= 1_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000).toFixed(1)}k`;
};

/** 上下文占用的百分比，取整显示（如窗口 128k、占用 77.1k → `60`） */
export const contextPercent = (context: ContextUsage): number =>
  Math.round((context.tokens / context.contextWindow) * 100);

/** 会话来源文案：主会话 / 子智能体 / 分叉 */
export const usageKindLabel = (kind: SessionUsageKind, t: TFunction): string => {
  switch (kind) {
    case "subagent":
      return t("子会话");
    case "forked":
      return t("分叉");
    case "primary":
      return t("主会话");
  }
};

/** 时长文案：只保留两级量级（天+时 / 时+分 / 分），不足一分钟统一说「不到 1 分钟」 */
export const formatDuration = (ms: number, t: TFunction): string => {
  const parts = durationParts(ms);
  if (parts.days > 0)
    return t("{{days}} 天 {{hours}} 小时", { days: parts.days, hours: parts.hours });
  if (parts.hours > 0) {
    return t("{{hours}} 小时 {{minutes}} 分", { hours: parts.hours, minutes: parts.minutes });
  }
  if (parts.minutes > 0) return t("{{minutes}} 分钟", { minutes: parts.minutes });
  return t("不到 1 分钟");
};
