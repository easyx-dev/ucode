/**
 * 目标栏：显示当前会话目标与进度，并提供暂停 / 恢复 / 清除、额度设置与逐轮回看。
 *
 * 它是输入卡的上沿一条——宽度、居中与圆角都由卡给（见 `docs/design-surfaces.md`「输入区」），
 * 自身只画下沿那条分隔线。容器窄于 36rem 时主行只留目标、状态与暂停 / 恢复，`⋯` 再**往上展开一行**
 * 放逐轮记录、用量与清除（同一份控件，不另做弹层）。逐轮列表与消息区的「目标续跑」分隔行同源。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  Check,
  ChevronDown,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../base/button";
import { Input } from "../../base/input";
import type { GoalView } from "../../types";
import { formatTokens } from "../../utils/usage";
import type { GoalTurn } from "../chat/message/goal-turns";
import type { GoalCommand } from "./goal-command";
import { goalCauseText, goalTurnLabel } from "./goal-text";

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

/** 逐轮记录的内容行：轮次 · 规模摘要 · 理由，放不下就折行 */
function GoalTurnRows({ turns }: { turns: GoalTurn[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      {turns.map((turn) => (
        <div key={turn.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="shrink-0 text-foreground-subtle">{goalTurnLabel(turn, t)}</span>
          <span className="shrink-0 text-foreground-subtlest">{turnSummary(turn, t)}</span>
          <span className="min-w-0 flex-1 truncate text-foreground-subtle" title={turnReason(turn)}>
            {turnReason(turn)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 用量与预算：宽屏挂在主行里，窄屏在 `⋯` 展开的那一行里，两处都用它。
 * 编辑态由它自己管——两处不会同时在屏上（主行里那份在 36rem 以上才显示）。
 */
function GoalBudgetControl({
  goal,
  onBudget,
}: {
  goal: GoalView;
  onBudget: (tokenBudget: number | null) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = (): void => {
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

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          autoFocus
          className="h-6 w-28 px-2 py-0 text-xs"
          placeholder={t("输入 token 上限，留空表示不限")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setEditing(false);
          }}
        />
        <IconButton size="icon-xs" label={t("保存")} onClick={commit}>
          <Check className="size-icon-xs" />
        </IconButton>
        <IconButton size="icon-xs" label={t("取消")} onClick={() => setEditing(false)}>
          <X className="size-icon-xs" />
        </IconButton>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-foreground-subtle hover:text-foreground"
      tooltip={t("设置预算")}
      onClick={start}
    >
      <span className="tabular-nums">{usageText(goal, t)}</span>
      <Pencil className="size-icon-xs" />
    </Button>
  );
}

/** 元数据（逐轮记录 · 用量）：宽屏在主行里，窄屏在 `⋯` 展开的那一行里，两处共用这一份 */
function GoalMetaControls({
  goal,
  turns,
  turnsOpen,
  onToggleTurns,
  onBudget,
}: {
  goal: GoalView;
  turns: GoalTurn[];
  turnsOpen: boolean;
  onToggleTurns: () => void;
  onBudget: (tokenBudget: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {turns.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-foreground-subtle hover:text-foreground"
          tooltip={turnsOpen ? t("收起逐轮记录") : t("展开逐轮记录")}
          aria-expanded={turnsOpen}
          onClick={onToggleTurns}
        >
          {/* 轮数与消息区的「目标续跑 · 第 n 轮」同口径（不含启动那一轮），故为 0 时不报数 */}
          <ChevronDown
            className={cn("size-icon-xs transition-transform", turnsOpen && "rotate-180")}
          />
          <span className="tabular-nums">
            {goal.turns > 0 ? t("第 {{n}} 轮", { n: goal.turns }) : t("逐轮记录")}
          </span>
        </Button>
      ) : null}
      <GoalBudgetControl goal={goal} onBudget={onBudget} />
    </>
  );
}

/** 清除目标：宽屏在主行右端，窄屏在 `⋯` 展开的那一行右端 */
function GoalClearButton({
  className,
  onCommand,
}: {
  className?: string;
  onCommand: (command: GoalCommand) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn("text-foreground-subtle hover:text-destructive", className)}
      onClick={() => onCommand({ kind: "clear" })}
    >
      <Trash2 className="size-icon-xs" />
      {t("清除")}
    </Button>
  );
}

export function GoalBar({ goal, turns, onCommand, onBudget }: GoalBarProps) {
  const { t } = useTranslation();
  const [turnsOpen, setTurnsOpen] = useState(false);
  /** 窄容器里「更多操作」展开的那一行；宽容器不用它（元数据就在主行里） */
  const [metaOpen, setMetaOpen] = useState(false);
  const active = goal.status === "active";
  const completed = goal.status === "completed";

  const toggleMeta = (): void => {
    // 收起这一行时把里面的展开态一起收掉：窄屏的逐轮列表就铺在这一行里，入口没了它也不该留在别处
    if (metaOpen) setTurnsOpen(false);
    setMetaOpen((prev) => !prev);
  };

  return (
    <div className="@container rounded-t-lg border-b border-border bg-muted/50 px-3 py-1.5">
      {/* 窄容器里往上长的一行：内容就是主行里那份元数据 + 清除 */}
      {metaOpen ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-1.5 text-xs @[36rem]:hidden">
          <GoalMetaControls
            goal={goal}
            turns={turns}
            turnsOpen={turnsOpen}
            onToggleTurns={() => setTurnsOpen((prev) => !prev)}
            onBudget={onBudget}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <GoalClearButton onCommand={onCommand} />
          </div>
          {/* 逐轮列表跟着它的入口走：窄屏就铺在这一行里（宽屏那一次由主行下方渲染） */}
          {turnsOpen ? (
            <div className="w-full pt-1.5">
              <GoalTurnRows turns={turns} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-xs">
        <Target aria-hidden className="size-icon-base shrink-0 text-foreground-subtle" />
        {/* 不撑满：状态与元数据紧跟目标，空出来的宽度给右侧动作（撑满会把状态推到行尾） */}
        <span className="min-w-0 truncate font-medium text-foreground" title={goal.objective}>
          {goal.objective}
        </span>
        {/* 状态是这条带子的主线：点表达「跑着还是停着」，文案照旧，不靠颜色单独表意 */}
        <span className="flex shrink-0 items-center gap-1.5 text-foreground-subtle">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-foreground-subtle")}
          />
          {statusText(goal, t)}
        </span>
        <div className="hidden shrink-0 items-center gap-0.5 @[36rem]:flex">
          <GoalMetaControls
            goal={goal}
            turns={turns}
            turnsOpen={turnsOpen}
            onToggleTurns={() => setTurnsOpen((prev) => !prev)}
            onBudget={onBudget}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("暂停")}
              onClick={() => onCommand({ kind: "pause" })}
            >
              <Pause className="size-icon-xs" />
              <span className="hidden @[36rem]:inline">{t("暂停")}</span>
            </Button>
          ) : null}
          {!active && !completed ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("恢复")}
              onClick={() => onCommand({ kind: "resume" })}
            >
              <Play className="size-icon-xs" />
              <span className="hidden @[36rem]:inline">{t("恢复")}</span>
            </Button>
          ) : null}
          <GoalClearButton className="hidden @[36rem]:inline-flex" onCommand={onCommand} />
          {/* 窄容器里的「更多操作」：往上方展开一行，不是弹层 */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="@[36rem]:hidden"
            aria-label={t("更多操作")}
            aria-expanded={metaOpen}
            tooltip={t("更多操作")}
            onClick={toggleMeta}
          >
            <MoreHorizontal className="size-icon-xs" />
          </Button>
        </div>
      </div>
      {/* 次级说明缩进到目标文字的左缘（图标 16 + 间隙 8 = `pl-6`）；逐轮列表宽屏在下面这一处，
          窄屏在 `⋯` 展开的那一行里（容器查询二选一） */}
      {goal.verification?.nextStep ? (
        <div
          className="mt-0.5 truncate pl-6 text-xs text-foreground-subtle"
          title={goal.verification.nextStep}
        >
          {goal.verification.nextStep}
        </div>
      ) : null}
      {turnsOpen ? (
        <div className="mt-1.5 hidden border-t border-border pt-1.5 pl-6 @[36rem]:block">
          <GoalTurnRows turns={turns} />
        </div>
      ) : null}
    </div>
  );
}
