/**
 * 工具集声明：工具名清单与自研工具装配。
 *
 * 「本次会话启用哪些工具」由角色能力决定；`buildCustomTools` 按**实际可用的工具名集合**注册，
 * 集合里没有的（被角色档位或能力交集去掉的）就不注册，避免出现「声明与注册脱节」的静默失效。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { WebsearchConfig } from "@ucode/contracts";
import { createSubagentTool, type SubagentHooks } from "../../features/subagents";
import type { AgentProfile } from "../agents";
import {
  createGoalBlockedTool,
  createGoalCompleteTool,
  GOAL_BLOCKED_TOOL,
  GOAL_COMPLETE_TOOL,
  type GoalToolHooks,
} from "./goal";
import { SUBAGENT_TOOL_NAME } from "./names";
import { createPresentPlanTool } from "./present-plan";
import { createQuestionTool, type QuestionHooks } from "./question";
import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch";

export {
  CUSTOM_TOOL_NAMES,
  DEFAULT_BUILTIN_TOOLS,
  DEFAULT_EXTENSION_TOOLS,
  GOAL_TOOL_NAMES,
} from "./names";

export type CustomToolInput = {
  /** 本次会话实际可用的工具名（已与父能力取交集、已去掉排除项） */
  names: readonly string[];
  readWebsearchConfig: () => WebsearchConfig;
  question?: QuestionHooks;
  subagents?: SubagentHooks;
  /** 供 `subagent` 工具列出可选角色；缺省回落内置子角色 */
  subagentProfiles?: readonly AgentProfile[];
  memoryTools?: ToolDefinition[];
  /** 目标结算工具通道；只在会话有 active 目标时注入（同记忆工具的条件注册） */
  goal?: GoalToolHooks;
};

export const buildCustomTools = (input: CustomToolInput): ToolDefinition[] => {
  const has = (name: string): boolean => input.names.includes(name);
  return [
    ...(has("webfetch") ? [createWebfetchTool()] : []),
    ...(has("websearch") ? [createWebsearchTool(input.readWebsearchConfig)] : []),
    ...(has("question") && input.question ? [createQuestionTool(input.question)] : []),
    ...(has("present_plan") ? [createPresentPlanTool()] : []),
    ...(has(SUBAGENT_TOOL_NAME) && input.subagents
      ? [createSubagentTool(input.subagents, input.subagentProfiles ?? [])]
      : []),
    // 两个工具各按自己的名字判定：角色白名单里只写其中一个时，只该挂上那一个
    ...(has(GOAL_COMPLETE_TOOL) && input.goal ? [createGoalCompleteTool(input.goal)] : []),
    ...(has(GOAL_BLOCKED_TOOL) && input.goal ? [createGoalBlockedTool(input.goal)] : []),
    ...(input.memoryTools ?? []),
  ];
};
