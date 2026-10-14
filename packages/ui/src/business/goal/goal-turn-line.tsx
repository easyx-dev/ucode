/**
 * 目标逐轮的分隔行：一次注入（启动 / 续跑 / 恢复）与它那一轮的结论合成一条线。
 *
 * 一轮的目标执行在消息区占一条线而不是一条用户气泡——它不是用户打的字。
 * 展开看校验给出的理由与下一步；还没结论时（这一轮还在跑）展开看注入原文。
 */
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { durationLabel } from "../../utils/time";
import { formatTokens } from "../../utils/usage";
import { DividerLine } from "../chat/message/divider-line";
import type { GoalTurn } from "../chat/message/goal-turns";
import { goalCauseText, goalTurnLabel } from "./goal-text";

/** 结论侧的量：结论 · 暂停原因 · 本轮 token · 工具调用 · 耗时，空项滤掉后以 `·` 连接 */
const detailOf = (turn: GoalTurn, t: TFunction): string => {
  const outcome = turn.outcome;
  if (!outcome) return "";
  const parts: string[] = [];
  if (outcome.achieved === true) parts.push(t("已完成"));
  else if (outcome.achieved === false) parts.push(t("未达成"));
  if (outcome.event === "pause" && outcome.cause) {
    parts.push(goalCauseText(outcome.cause, t));
  }
  if (outcome.turnTokens !== undefined) {
    parts.push(t("{{used}} token", { used: formatTokens(outcome.turnTokens) }));
  }
  if (outcome.turnToolCalls !== undefined) {
    parts.push(t("工具调用 {{value}} 次", { value: outcome.turnToolCalls }));
  }
  if (outcome.turnMs !== undefined) {
    parts.push(t("耗时 {{value}}", { value: durationLabel(outcome.turnMs) }));
  }
  return parts.join(" · ");
};

export function GoalTurnLine({ turn }: { turn: GoalTurn }) {
  const { t } = useTranslation();
  const reason = turn.outcome?.reason?.trim() ?? "";
  const nextStep = turn.outcome?.nextStep?.trim() ?? "";
  const text = turn.text.trim();

  return (
    <DividerLine
      label={goalTurnLabel(turn, t)}
      detail={detailOf(turn, t)}
      defaultOpen={reason.length > 0}
    >
      {reason || nextStep ? (
        <div className="space-y-1">
          {reason ? <p className="whitespace-pre-wrap">{reason}</p> : null}
          {nextStep ? <p className="whitespace-pre-wrap">{nextStep}</p> : null}
        </div>
      ) : text ? (
        <p className="whitespace-pre-wrap">{text}</p>
      ) : undefined}
    </DividerLine>
  );
}
