/** 权限档位的界面文案：接口用英文 slug，展示时映射到当前语言 */
import type { TFunction } from "i18next";

import { PERMISSION_MODES, type PermissionMode } from "./types";

const isPermissionMode = (value: string): value is PermissionMode =>
  (PERMISSION_MODES as readonly string[]).includes(value);

/**
 * 会话记录里的档位是未校验的字符串（可能来自手改的文件）：认识的走本地化，不认识的原样显示。
 * 界面自己的选择器用 `permissionModeLabel`，那里传的是强类型值。
 */
export const permissionModeText = (value: string, t: TFunction): string =>
  isPermissionMode(value) ? permissionModeLabel(value, t) : value;

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
