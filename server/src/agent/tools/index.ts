/**
 * 工具集声明：工具名清单与自研工具装配。
 *
 * 「本次会话启用哪些工具」由角色能力决定；`buildCustomTools` 按**实际可用的工具名集合**注册，
 * 集合里没有的（被角色档位或能力交集去掉的）就不注册，避免出现「声明与注册脱节」的静默失效。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { WebsearchConfig } from "@ucode/contracts";

import { createSubagentTool, type SubagentHooks } from "../subagents";
import { createPresentPlanTool } from "./present-plan";
import { createQuestionTool, type QuestionHooks } from "./question";
import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch/index";

export { CUSTOM_TOOL_NAMES, DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "./names";

export type CustomToolInput = {
  /** 本次会话实际可用的工具名（已与父能力取交集、已去掉排除项） */
  names: readonly string[];
  readWebsearchConfig: () => WebsearchConfig;
  question?: QuestionHooks;
  subagents?: SubagentHooks;
  memoryTools?: ToolDefinition[];
};

export const buildCustomTools = (input: CustomToolInput): ToolDefinition[] => {
  const has = (name: string): boolean => input.names.includes(name);
  return [
    ...(has("webfetch") ? [createWebfetchTool()] : []),
    ...(has("websearch") ? [createWebsearchTool(input.readWebsearchConfig)] : []),
    ...(has("question") && input.question ? [createQuestionTool(input.question)] : []),
    ...(has("present_plan") ? [createPresentPlanTool()] : []),
    ...(has("subagent") && input.subagents ? [createSubagentTool(input.subagents)] : []),
    ...(input.memoryTools ?? []),
  ];
};
