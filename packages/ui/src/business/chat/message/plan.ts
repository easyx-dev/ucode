/** 计划决策：判断本轮生成是否以 present_plan 收尾，plan 模式据此弹出决策表单 */
import { PLAN_IGNORED_CUSTOM_TYPE } from "@ucode/contracts";
import type { ChatItem } from "../../../types";

/** 计划收尾工具：内部信号，调用不进消息区（见 chat-nodes 的过滤），但本模块的判定依赖历史条目里的它 */
export const PRESENT_PLAN_TOOL = "present_plan";

/** 该条是否为「已忽略本次计划」的界面标记（区别于其它扩展消息） */
export const isPlanIgnored = (item: ChatItem): boolean =>
  item.customType === PLAN_IGNORED_CUSTOM_TYPE;

/** 自最后一条用户消息起，是否出现过 present_plan 调用；遇到本轮用户消息或忽略标记即停 */
export const lastTurnPresentedPlan = (items: ChatItem[]): boolean => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    // 扫到本轮的用户消息说明再往前就不是这一轮了
    if (item.role === "user") return false;
    // 本轮计划已被忽略：表单不再弹出（新计划在标记之后，会先被扫到）
    if (isPlanIgnored(item)) return false;
    if (item.toolName === PRESENT_PLAN_TOOL) return true;
    if (
      item.blocks.some((block) => block.type === "toolCall" && block.name === PRESENT_PLAN_TOOL)
    ) {
      return true;
    }
  }
  return false;
};
