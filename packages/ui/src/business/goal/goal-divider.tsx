/**
 * 目标完成的分隔行：目标跑到校验通过时在对话里留一条线，展开可以看到校验结论。
 *
 * 状态条用完即收（见 `GoalBar` 的渲染条件），这条线才是事后回看「目标在哪儿结束、为什么算完成」的凭据。
 */
import type { GoalRecord } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import { formatTokens } from "../../utils/usage";
import { DividerLine } from "../chat/message/divider-line";

export function GoalDivider({ record }: { record: GoalRecord }) {
  const { t } = useTranslation();
  const detail =
    record.turns === undefined
      ? null
      : t("{{turns}} 轮 · {{tokens}}", {
          turns: record.turns,
          tokens: formatTokens(record.tokensUsed ?? 0),
        });
  const reason = record.verdict?.reason?.trim() ?? "";

  return (
    <DividerLine label={t("目标完成")} detail={detail} defaultOpen={reason.length > 0}>
      {reason ? <p className="whitespace-pre-wrap">{reason}</p> : undefined}
    </DividerLine>
  );
}
