/**
 * 合成输入的分隔行：目标启动 / 续跑 / 恢复与计划批准都不是用户打的字，
 * 展开可以看到注入给模型的原文，但不再占一条用户气泡。
 */
import { type GoalPromptDetails, PLAN_APPROVED_CUSTOM_TYPE } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import { DividerLine } from "../../../base/divider-line";

type InjectedLineProps = {
  /** 注入条目的 customType：决定文案口径 */
  customType?: string;
  /** 目标注入的来源与轮次；其它类型的注入没有 */
  prompt?: GoalPromptDetails;
  /** 注入的正文 */
  text: string;
};

export function InjectedLine({ customType, prompt, text }: InjectedLineProps) {
  const { t } = useTranslation();
  const label =
    customType === PLAN_APPROVED_CUSTOM_TYPE
      ? t("计划已批准")
      : prompt?.kind === "continuation"
        ? t("目标续跑 · 第 {{turn}} 轮", { turn: prompt.turn ?? 1 })
        : prompt?.kind === "resume"
          ? t("目标恢复")
          : t("目标启动");

  return (
    <DividerLine label={label}>
      <p className="whitespace-pre-wrap">{text}</p>
    </DividerLine>
  );
}
