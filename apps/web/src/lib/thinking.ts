/** 推理等级的界面文案：接口与 pi 一样用英文档位名，展示时映射到当前语言 */
import type { TFunction } from "i18next";

import type { ThinkingLevel } from "./types";

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
