/**
 * 目标模式在界面上的两处共用文案：注入轮次的标题与暂停原因的措辞。
 *
 * 目标栏与消息区的逐轮分隔行都要说同一件事，口径放在这里，免得两处各写一份。
 */
import type { GoalPauseCause, GoalPromptKind } from "@ucode/contracts";
import type { TFunction } from "i18next";

/** 注入轮次的标题：启动 / 续跑（带轮号）/ 恢复 */
export const goalTurnLabel = (
  prompt: { kind: GoalPromptKind; turn?: number },
  t: TFunction,
): string =>
  prompt.kind === "continuation"
    ? t("目标续跑 · 第 {{turn}} 轮", { turn: prompt.turn ?? 1 })
    : prompt.kind === "resume"
      ? t("目标恢复")
      : t("目标启动");

/** 暂停原因的措辞；未登记的原因（不该出现）回落「已暂停」 */
export const goalCauseText = (cause: GoalPauseCause | null, t: TFunction): string => {
  switch (cause) {
    case "mode":
      return t("因切换模式暂停");
    case "interrupted":
      return t("已中断");
    case "no_progress":
      return t("无进展已暂停");
    case "limit":
      return t("达到轮数上限");
    case "budget":
      return t("达到用量上限");
    case "error":
      return t("生成出错已暂停");
    case "blocked":
      return t("因受阻暂停");
    default:
      return t("已暂停");
  }
};
