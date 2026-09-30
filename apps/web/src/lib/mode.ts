/** 助手模式的界面文案：接口用英文 slug，展示时映射到当前语言 */
import type { TFunction } from "i18next";

import type { SessionMode } from "./types";

/** 选择器里的简短名称 */
export const modeLabel = (mode: SessionMode, t: TFunction): string => {
  switch (mode) {
    case "build":
      return t("编码模式");
    case "plan":
      return t("计划模式");
    case "ask":
      return t("问答模式");
  }
};

/** 悬停说明，讲清该模式能做什么 */
export const modeDescription = (mode: SessionMode, t: TFunction): string => {
  switch (mode) {
    case "build":
      return t("编码模式.说明");
    case "plan":
      return t("计划模式.说明");
    case "ask":
      return t("问答模式.说明");
  }
};
