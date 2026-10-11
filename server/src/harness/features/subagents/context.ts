/**
 * 子会话上下文策略的选择口子。
 *
 * v1 只实现 `fresh`（子会话从空白开始，只拿到 task）；`fork` 需要从父会话的某个节点分叉出会话文件，
 * 与后续「会话分叉」功能共用同一原语，故这里先只定形状、不实现。
 */
import type { AgentProfile } from "../../setup/agents";
import { DEFAULT_SUBAGENT_CONTEXT } from "./types";

export type SubagentContextPlan =
  | { kind: "fresh" }
  /** `fromEntryId` 为空表示从父会话当前叶子分叉 */
  | { kind: "fork"; fromEntryId: string | null };

/** 解析子会话的上下文策略；v1 固定 fresh，角色声明与调用入参都不暴露 fork */
export const resolveContextPlan = (_profile: AgentProfile): SubagentContextPlan =>
  DEFAULT_SUBAGENT_CONTEXT === "fork" ? { kind: "fork", fromEntryId: null } : { kind: "fresh" };
