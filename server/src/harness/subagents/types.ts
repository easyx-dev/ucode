/**
 * 子智能体运行时：由父会话的工具调用触发，前台跑一个独立子会话并只回传最终文本。
 *
 * 能力（工具集 / 权限 / 模型）由 `harness/agents` 与父会话取交集后交给装配层；
 * 这里只关心生命周期：建行 → 取会话实例 → prompt → 取文本 → 回收。
 */
import type { ThinkingLevel } from "@ucode/contracts";

/** 一次委派请求：对应 `subagent` 工具入参 */
export type SubagentRequest = {
  /** 子角色 slug；缺省 general（续跑且未指定时沿用原子会话角色） */
  agent?: string;
  /** 任务简称，用于会话名与后续进度展示；续跑时可省 */
  description?: string;
  /** 交给子会话的完整任务，必须自包含 */
  task: string;
  /** 已有子会话 id；带上则在该子会话上续跑，不新建 */
  taskId?: string;
  /** 覆盖模型 `provider/model`；缺省继承父会话 */
  model?: string;
  /** 覆盖思考档位；缺省继承父会话 */
  thinkingLevel?: ThinkingLevel;
};

export type SubagentResult = {
  /** 子会话 id（回传给父会话作 `task_id`） */
  sessionId: string;
  /** 子会话最后一条 assistant 文本 */
  text: string;
};

export type SubagentHooks = {
  /** `toolCallId` 用于把子会话进度帧关联回父会话里的这次调用 */
  spawn: (
    toolCallId: string,
    request: SubagentRequest,
    signal?: AbortSignal,
  ) => Promise<SubagentResult>;
};

/** 子会话上下文策略，`fresh` 现用；`fork` 与后续「会话分叉」共用原语 */
export type SubagentContextStrategy = "fresh" | "fork";

export const DEFAULT_SUBAGENT_CONTEXT: SubagentContextStrategy = "fresh";
