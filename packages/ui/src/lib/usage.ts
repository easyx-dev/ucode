/** 使用统计的展示辅助：token 紧凑格式化与会话来源文案 */
import type { TFunction } from "i18next";

import type { SessionUsageKind } from "./types";

/** token 数按千 / 百万紧凑显示，如 `12.3k`、`1.2M` */
export const formatTokens = (value: number): string => {
  if (value < 1_000) return String(value);
  // 四舍五入到千位会进位成 1000.0k 的，直接升到 M，避免出现 `1000.0k`
  if (Math.round(value / 1_000) >= 1_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000).toFixed(1)}k`;
};

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
