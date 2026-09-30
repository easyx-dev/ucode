/** 计划决策：判断本轮生成是否以 present_plan 收尾，plan 模式据此弹出决策表单 */
import type { ChatItem } from "./types";

const PRESENT_PLAN = "present_plan";

/** 自最后一条用户消息起，是否出现过 present_plan 调用 */
export const lastTurnPresentedPlan = (items: ChatItem[]): boolean => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    // 扫到本轮的用户消息说明再往前就不是这一轮了
    if (item.role === "user") return false;
    if (item.toolName === PRESENT_PLAN) return true;
    if (item.blocks.some((block) => block.type === "toolCall" && block.name === PRESENT_PLAN)) {
      return true;
    }
  }
  return false;
};
