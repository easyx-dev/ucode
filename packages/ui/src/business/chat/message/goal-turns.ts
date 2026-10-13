/**
 * 目标模式的逐轮配对：把「目标注入」与它那一轮的结论（校验 / 完成 / 暂停）配成一轮。
 *
 * 按**条目顺序**配对，不按轮号——暂停后恢复会沿用同一轮号，轮号当 key 会把两轮并到一起。
 * 配对成功的结论记录进 `consumed`，渲染时不再重复成行（它已经并进那条分隔行了）。
 */
import {
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_RECORD_CUSTOM_TYPE,
  type GoalPauseCause,
  type GoalPromptKind,
  type GoalRecord,
} from "@ucode/contracts";
import type { ChatItem } from "../../../types";
import { itemText, uidOf } from "./chat-item";

/** 归到某一轮的结论；字段按记录事件可选 */
export type GoalTurnOutcome = {
  /** `verdict` 表示本轮跑完、目标仍在推进；`completed` / `pause` 表示目标停在这一轮 */
  event: "verdict" | "completed" | "pause";
  achieved?: boolean;
  reason?: string;
  nextStep?: string;
  /** 停在这一轮时的原因；只有 `pause` 有 */
  cause?: GoalPauseCause;
  /** 本轮的用量增量（token，含校验开销） */
  turnTokens?: number;
  /** 本轮的工具调用次数 */
  turnToolCalls?: number;
  /** 本轮耗时（毫秒） */
  turnMs?: number;
};

/** 一轮目标执行：一次注入 + 它的结论 */
export type GoalTurn = {
  /** 该轮注入条目的稳定 key */
  key: string;
  kind: GoalPromptKind;
  /** 注入时带的轮号；启动 / 恢复没有轮号 */
  turn?: number;
  /** 注入的时刻（ISO 8601）；时间不可用时缺省，用来按目标起点裁剪 */
  at?: string;
  /** 注入给模型的原文（没有结论时展开看它） */
  text: string;
  outcome?: GoalTurnOutcome;
};

export type GoalTurns = {
  /** 按条目顺序的轮次列表 */
  turns: GoalTurn[];
  /** 已被归轮的结论条目 uid */
  consumed: Set<string>;
};

/** 归轮的记录事件：其余（set / resume / clear / budget）不并进分隔行 */
const TURN_EVENTS = ["verdict", "completed", "pause"] as const;

type TurnEvent = (typeof TURN_EVENTS)[number];

const isTurnEvent = (event: GoalRecord["event"]): event is TurnEvent =>
  (TURN_EVENTS as readonly string[]).includes(event);

const outcomeOf = (record: GoalRecord): GoalTurnOutcome => ({
  event: record.event as TurnEvent,
  ...(record.verdict ? { achieved: record.verdict.achieved } : {}),
  ...(record.verdict?.reason ? { reason: record.verdict.reason } : {}),
  ...(record.verdict?.nextStep ? { nextStep: record.verdict.nextStep } : {}),
  ...(record.cause ? { cause: record.cause } : {}),
  ...(record.turnTokens !== undefined ? { turnTokens: record.turnTokens } : {}),
  ...(record.turnToolCalls !== undefined ? { turnToolCalls: record.turnToolCalls } : {}),
  ...(record.turnMs !== undefined ? { turnMs: record.turnMs } : {}),
});

/**
 * 后一条记录只覆盖它带的字段（`outcomeOf` 只写实际有的键）：一次落定可能连落两条
 * （先 `verdict`，再因触到止损落 `pause`），后者没有校验结论，不能把结论一并盖掉。
 */
const mergeOutcome = (
  previous: GoalTurnOutcome | undefined,
  next: GoalTurnOutcome,
): GoalTurnOutcome => ({ ...previous, ...next });

export const buildGoalTurns = (items: ChatItem[]): GoalTurns => {
  const turns: GoalTurn[] = [];
  const consumed = new Set<string>();

  for (const item of items) {
    if (item.customType === GOAL_PROMPT_CUSTOM_TYPE && item.goalPrompt) {
      const { kind, turn } = item.goalPrompt;
      turns.push({
        key: uidOf(item),
        kind,
        ...(turn !== undefined ? { turn } : {}),
        ...(item.createdAt ? { at: item.createdAt } : {}),
        text: itemText(item),
      });
      continue;
    }
    const record = item.customType === GOAL_RECORD_CUSTOM_TYPE ? item.goalRecord : undefined;
    if (!record || !isTurnEvent(record.event)) continue;
    // 开轮条目被压缩掉的历史记录无处可归：既不并进任何一轮，也不消费掉
    const open = turns[turns.length - 1];
    if (!open) continue;
    consumed.add(uidOf(item));
    open.outcome = mergeOutcome(open.outcome, outcomeOf(record));
  }

  return { turns, consumed };
};
