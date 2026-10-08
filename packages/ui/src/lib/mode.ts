/** 助手模式的界面文案：接口用英文 slug，展示时映射到当前语言；自定义 slug 回落原始值 */
import type { ModeRecord } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { permissionModeText } from "./permission";

/** 选择器里的简短名称 */
export const modeLabel = (mode: string, t: TFunction): string => {
  switch (mode) {
    case "build":
      return t("编码");
    case "plan":
      return t("计划");
    case "ask":
      return t("问答");
    default:
      return mode;
  }
};

/** 悬停说明，讲清该模式能做什么 */
export const modeDescription = (mode: string, t: TFunction): string => {
  switch (mode) {
    case "build":
      return t("可直接读写文件、执行命令。");
    case "plan":
      return t("先给出方案，只读调研不改代码。");
    case "ask":
      return t("只读分析与回答，不改文件、不执行命令。");
    default:
      return "";
  }
};

/** 模式 / 权限档位变更的细线文案：只换一个时点明换的是哪一个，两个一起换就一并列出 */
export const modeChangeText = (
  record: ModeRecord,
  t: TFunction,
): { label: string; detail?: string } => {
  const mode = record.mode === undefined ? null : modeLabel(record.mode, t);
  const permission =
    record.permissionMode === undefined ? null : permissionModeText(record.permissionMode, t);
  if (mode && permission) {
    return { label: t("模式与权限档位已切换"), detail: `${mode} · ${permission}` };
  }
  if (mode) return { label: t("模式已切换"), detail: mode };
  return { label: t("权限档位已切换"), detail: permission ?? "" };
};
