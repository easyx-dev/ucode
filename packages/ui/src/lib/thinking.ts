/** 推理等级的界面文案：接口与 pi 一样用英文档位名，展示时映射到当前语言 */
import type { TFunction } from "i18next";

import type { ThinkingLevel, ThinkingPreference } from "./types";

export const thinkingLevelLabel = (level: ThinkingLevel, t: TFunction): string => {
  switch (level) {
    case "off":
      return t("关闭");
    case "minimal":
      return t("极少");
    case "low":
      return t("低");
    case "medium":
      return t("中");
    case "high":
      return t("高");
    case "xhigh":
      return t("极高");
    case "max":
      return t("最高");
  }
};

/**
 * 选择器上显示的档位。`auto` 一并给出实际生效的档位（「自动 · 极高」），
 * 免得「自动」变成一个问不出所以然的黑盒；`resolved` 未知（还没有会话）时只显示「自动」。
 */
export const thinkingPreferenceLabel = (
  preference: ThinkingPreference,
  resolved: ThinkingLevel | undefined,
  t: TFunction,
): string => {
  if (preference !== "auto") return thinkingLevelLabel(preference, t);
  return resolved ? t("自动 · {{level}}", { level: thinkingLevelLabel(resolved, t) }) : t("自动");
};
