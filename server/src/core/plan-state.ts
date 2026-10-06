/**
 * 计划待决策状态：从会话条目判定「本轮是否以 present_plan 收尾且尚未决策」。
 *
 * 判定与前端 `lib/plan.ts` 同口径：present_plan 是 plan 模式的收尾工具，调用即本轮结束，
 * 所以「最后一条用户消息之后出现过 present_plan」就等于「有一份计划在等用户批准 / 反馈」。
 * 用户给出反馈会开新一轮（再次扫到用户消息即算已决策），点「忽略」会在会话文件末尾追加标记条目。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { PLAN_IGNORED_CUSTOM_TYPE } from "@ucode/contracts";
import { isRecord } from "../utils/object";

const PRESENT_PLAN = "present_plan";

/** 「本轮计划已被忽略」的界面标记；它之后的条目属于新一轮，扫到即停 */
const isIgnored = (entry: SessionEntry): boolean =>
  entry.type === "custom" && entry.customType === PLAN_IGNORED_CUSTOM_TYPE;

/** 该条目是否留下了 present_plan 的痕迹：工具结果行，或助手消息里的调用块 */
const hasPresentPlan = (entry: SessionEntry): boolean => {
  if (entry.type !== "message") return false;
  const message = entry.message;
  if (message.role === "toolResult") return message.toolName === PRESENT_PLAN;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
  return message.content.some(
    (part) => isRecord(part) && part.type === "toolCall" && part.name === PRESENT_PLAN,
  );
};

/** 从末尾回扫活动分支的条目；先遇到用户消息或忽略标记说明本轮没有待决策的计划 */
export const isPlanAwaitingDecision = (entries: readonly SessionEntry[]): boolean => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.type === "message" && entry.message.role === "user") return false;
    if (isIgnored(entry)) return false;
    if (hasPresentPlan(entry)) return true;
  }
  return false;
};
