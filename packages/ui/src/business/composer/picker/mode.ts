/** 助手模式的界面文案：接口用英文 slug，展示时映射到当前语言；自定义 slug 回落原始值 */
import type { TFunction } from "i18next";

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

/** 悬停说明，讲清该模式能做什么；与权限档位同长，都只占一行 */
export const modeDescription = (mode: string, t: TFunction): string => {
  switch (mode) {
    case "build":
      return t("读写文件、执行命令。");
    case "plan":
      return t("先出方案，只读调研不改代码。");
    case "ask":
      return t("只读分析，不改文件不跑命令。");
    default:
      return "";
  }
};
