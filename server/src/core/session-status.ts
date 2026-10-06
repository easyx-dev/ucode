/**
 * 会话状态的判定口径：把「活跃生成 / 挂起交互 / 本轮出错 / 计划待确认」几个来源收敛成一个状态。
 *
 * 只用池内事实：状态全部取自进程内存（`running` 占位、交互 broker 的挂起项、出错标记），
 * 因此服务重启或实例被空闲回收后回到 `idle`——这与已有的 `running` 是同一条边界。
 */
import type { PendingInteraction, SessionStatus } from "@ucode/contracts";

/** 判定所需的来源；都由会话池按 id 读取 */
export type SessionStatusSources = {
  /** 有活跃生成：池内 run 占位或会话正在流式输出 */
  active: boolean;
  /** 本轮以错误结束且尚未开始新一轮 */
  errored: boolean;
  /** 本会话挂起未答的交互请求类别 */
  pending: readonly PendingInteraction["kind"][];
  /** plan 模式本轮以 present_plan 收尾且尚未决策 */
  planPending: boolean;
};

/**
 * 状态优先级：待答请求 > 生成中 > 本轮出错 > 计划待确认 > 已完成。
 *
 * 待答请求排最前，因为它是唯一「用户不动作就没有进展」的状态，而此时 `running` 仍为真
 * （工具调用还挂在占位上）；计划待确认排在出错之后，因为本轮已经落定，出错才是更该先看到的信号。
 */
export const sessionStatusOf = (sources: SessionStatusSources): SessionStatus => {
  if (sources.pending.includes("permission")) return "waiting_permission";
  if (sources.pending.includes("question")) return "waiting_question";
  if (sources.active) return "running";
  if (sources.errored) return "error";
  if (sources.planPending) return "waiting_plan";
  return "idle";
};
