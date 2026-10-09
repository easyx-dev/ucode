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

/**
 * 模式 / 权限档位的细线文案：说的是「这一轮跑在什么参数下」，不是「刚切了设置」。
 * 写点在轮开始（每轮最多一条），所以这里不带「已切换」这类动作词。
 */
export const modeChangeText = (
  record: ModeRecord,
  t: TFunction,
): { label: string; detail: string } => {
  const parts = [
    record.mode === undefined ? null : modeLabel(record.mode, t),
    record.permissionMode === undefined ? null : permissionModeText(record.permissionMode, t),
  ].filter((part): part is string => part !== null);
  return { label: t("本轮参数"), detail: parts.join(" · ") };
};
