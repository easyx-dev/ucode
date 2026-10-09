/** 权限档位的界面文案：接口用英文 slug，展示时映射到当前语言 */
import type { TFunction } from "i18next";

import type { PermissionMode } from "./types";

/** 选择器里的简短名称 */
export const permissionModeLabel = (mode: PermissionMode, t: TFunction): string => {
  switch (mode) {
    case "default":
      return t("默认");
    case "auto":
      return t("自动批准");
    case "full":
      return t("完全访问");
    default:
      return mode;
  }
};

/** 悬停说明：讲清该档位会放宽什么、保留什么；一行放得下，多了会撑出参差不齐的两行 */
export const permissionModeDescription = (mode: PermissionMode, t: TFunction): string => {
  switch (mode) {
    case "default":
      return t("需要授权时弹窗确认。");
    case "auto":
      return t("常规工具放行，目录外仍询问。");
    case "full":
      return t("全部放行，仅保留规则阻断。");
    default:
      return "";
  }
};
