/**
 * 目标栏：显示当前会话目标与进度，并提供暂停 / 恢复 / 清除、额度设置与逐轮回看。
 *
 * 逐轮列表与消息区的「目标续跑」分隔行同源（`buildGoalTurns`），这里只是把它摊平。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { Check, ChevronRight, Pause, Pencil, Play, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Input } from "../base/input";
import type { GoalCommand } from "../lib/goal-command";
import { goalCauseText, goalTurnLabel } from "../lib/goal-text";
import type { GoalTurn } from "../lib/goal-turns";
import type { GoalView } from "../lib/types";
import { formatTokens } from "../lib/usage";

type GoalBarProps = {
  goal: GoalView;
  /** 已归轮的逐轮执行记录，按条目顺序 */
  turns: GoalTurn[];
  onCommand: (command: GoalCommand) => void;
  /** 提交新的 token 上限；null 表示不限 */
  onBudget: (tokenBudget: number | null) => void;
};

const statusText = (goal: GoalView, t: TFunction): string => {
  if (goal.status === "completed") return t("已完成");
  if (goal.status === "active") return t("进行中");
  return goalCauseText(goal.cause, t);
};

const usageText = (goal: GoalView, t: TFunction): string =>
  goal.tokenBudget
    ? t("{{used}} / {{budget}} token", {
        used: formatTokens(goal.tokensUsed),
        budget: formatTokens(goal.tokenBudget),
      })
    : t("{{used}} token", { used: formatTokens(goal.tokensUsed) });

/** 一轮的规模摘要：结论 · 暂停原因 · 本轮 token · 工具调用，空项滤掉后以 `·` 连接 */
const turnSummary = (turn: GoalTurn, t: TFunction): string => {
  const outcome = turn.outcome;
  if (!outcome) return "";
  const parts: string[] = [];
  if (outcome.achieved === true) parts.push(t("已完成"));
  else if (outcome.achieved === false) parts.push(t("未达成"));
  if (outcome.event === "pause" && outcome.cause) parts.push(goalCauseText(outcome.cause, t));
  if (outcome.turnTokens !== undefined) {
    parts.push(t("{{used}} token", { used: formatTokens(outcome.turnTokens) }));
  }
  if (outcome.turnToolCalls !== undefined) {
    parts.push(t("工具调用 {{value}} 次", { value: outcome.turnToolCalls }));
  }
  return parts.join(" · ");
};

/** 一轮的原因摘要；没有结论（这一轮还在跑）时为空 */
const turnReason = (turn: GoalTurn): string => {
  const outcome = turn.outcome;
  if (!outcome) return "";
  return outcome.reason || outcome.nextStep || "";
};

export function GoalBar({ goal, turns, onCommand, onBudget }: GoalBarProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [turnsOpen, setTurnsOpen] = useState(false);
  const active = goal.status === "active";
  const completed = goal.status === "completed";

  const startEditing = (): void => {
    setDraft(goal.tokenBudget === null ? "" : String(goal.tokenBudget));
    setEditing(true);
  };

  // 空串即取消上限；只收十进制正整数（`Number()` 会放行 `0x10` / `1e3`），非法值留在编辑态让用户改
  const commit = (): void => {
    const text = draft.trim();
    if (text.length === 0) {
      onBudget(null);
      setEditing(false);
      return;
    }
    if (!/^\d+$/.test(text)) return;
    const value = Number(text);
    if (value <= 0) return;
    onBudget(value);
    setEditing(false);
  };

  return (
    <div className="border-t border-border bg-muted/40 px-4 py-2">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-2 text-xs">
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
            {turns.length > 0 ? (
              <button
                type="button"
                className="flex shrink-0 items-center gap-0.5 text-muted-foreground hover:text-foreground"
                title={t("目标轮次")}
                aria-expanded={turnsOpen}
                onClick={() => setTurnsOpen((prev) => !prev)}
              >
                <ChevronRight
                  className={cn("size-3 transition-transform", turnsOpen && "rotate-90")}
                />
                {/* 轮数与消息区的「目标续跑 · 第 n 轮」同口径（不含启动那一轮），故为 0 时不报数 */}
                {goal.turns > 0 ? t("第 {{n}} 轮", { n: goal.turns }) : t("目标轮次")}
              </button>
            ) : null}
            {editing ? (
              <span className="flex shrink-0 items-center gap-1">
                <Input
                  autoFocus
                  className="h-5 w-28 px-1.5 py-0 text-xs"
                  placeholder={t("输入 token 上限，留空表示不限")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setEditing(false);
                  }}
                />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  title={t("保存")}
                  onClick={commit}
                >
                  <Check className="size-3" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground hover:text-foreground"
                title={t("设置预算")}
                onClick={startEditing}
              >
                {usageText(goal, t)}
                <Pencil className="size-3" />
              </button>
            )}
          </div>
          {goal.verification?.nextStep ? (
            <div
              className="mt-0.5 truncate text-muted-foreground"
              title={goal.verification.nextStep}
            >
              {goal.verification.nextStep}
            </div>
          ) : null}
          {turnsOpen ? (
            <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
              {turns.map((turn) => (
                <div key={turn.key} className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-muted-foreground">{goalTurnLabel(turn, t)}</span>
                  <span className="shrink-0 text-muted-foreground/70">{turnSummary(turn, t)}</span>
                  <span className="min-w-0 truncate text-muted-foreground" title={turnReason(turn)}>
                    {turnReason(turn)}
                  </span>
                </div>
              ))}
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
              {t("暂停")}
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
              {t("恢复")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onCommand({ kind: "clear" })}
          >
            <Trash2 className="size-3" />
            {t("清除")}
          </Button>
        </div>
      </div>
    </div>
  );
}
