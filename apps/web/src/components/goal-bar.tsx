/** 目标栏：显示当前会话目标与进度，并提供暂停 / 恢复 / 清除操作 */
import type { TFunction } from "i18next";
import { Pause, Play, Target, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { GoalCommand } from "@/lib/goal-command";
import type { GoalView } from "@/lib/types";
import { formatTokens } from "@/lib/usage";
import { cn } from "@/lib/utils";

type GoalBarProps = {
  goal: GoalView;
  onCommand: (command: GoalCommand) => void;
};

/** 状态文案：进行中 / 已完成，暂停时按原因区分 */
const statusText = (goal: GoalView, t: TFunction): string => {
  if (goal.status === "completed") return t("目标.已完成");
  if (goal.status === "active") return t("目标.进行中");
  switch (goal.cause) {
    case "mode":
      return t("目标.暂停.模式");
    case "interrupted":
      return t("目标.暂停.中断");
    case "no_progress":
      return t("目标.暂停.无进展");
    case "limit":
      return t("目标.暂停.轮数");
    case "budget":
      return t("目标.暂停.预算");
    case "error":
      return t("目标.暂停.错误");
    default:
      return t("目标.暂停.用户");
  }
};

const usageText = (goal: GoalView, t: TFunction): string =>
  goal.tokenBudget
    ? t("目标.用量.限额", {
        used: formatTokens(goal.tokensUsed),
        budget: formatTokens(goal.tokenBudget),
      })
    : t("目标.用量", { used: formatTokens(goal.tokensUsed) });

export function GoalBar({ goal, onCommand }: GoalBarProps) {
  const { t } = useTranslation();
  const active = goal.status === "active";
  const completed = goal.status === "completed";

  return (
    <div className="border-t border-border bg-muted/40 px-4 py-2">
      <div className="mx-auto flex w-full max-w-3xl items-start gap-2 text-xs">
        <Target
          className={cn(
            "mt-0.5 size-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground" title={goal.objective}>
              {goal.objective}
            </span>
            <span className="shrink-0 text-muted-foreground">{statusText(goal, t)}</span>
            {goal.turns > 0 ? (
              <span className="shrink-0 text-muted-foreground">
                {t("目标.轮数", { n: goal.turns })}
              </span>
            ) : null}
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {usageText(goal, t)}
            </span>
          </div>
          {goal.verification?.nextStep ? (
            <div
              className="mt-0.5 truncate text-muted-foreground"
              title={goal.verification.nextStep}
            >
              {goal.verification.nextStep}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => onCommand({ kind: "pause" })}
            >
              <Pause className="size-3" />
              {t("目标.暂停")}
            </Button>
          ) : null}
          {!active && !completed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => onCommand({ kind: "resume" })}
            >
              <Play className="size-3" />
              {t("目标.恢复")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onCommand({ kind: "clear" })}
          >
            <Trash2 className="size-3" />
            {t("目标.清除")}
          </Button>
        </div>
      </div>
    </div>
  );
}
