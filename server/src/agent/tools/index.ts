/**
 * 工具集装配：pi 内置工具的白名单与自研工具的汇入点。
 *
 * pi 的 `tools` 是**白名单**：只有列进去的工具才启用，自研工具不在其中同样会被过滤掉，
 * 所以内置清单与自研工具名必须成对维护——由 `buildSessionTools` 统一输出，别再各处手写。
 * 部分自研工具只在特定模式出现（如 `present_plan` 只属于 plan 模式），因此装配要收 mode。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SessionMode, WebsearchConfig } from "@ucode/contracts";

import { createPresentPlanTool } from "./present-plan";
import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch/index";

/** 内置工具：读写执行 + 只读检索（grep / find / ls） */
export const DEFAULT_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export type ToolAssembly = {
  /** 传给 `createAgentSession` 的工具白名单，含自研工具名 */
  tools: string[];
  /** 自研工具定义，随 `customTools` 注入 */
  customTools: ToolDefinition[];
};

export const buildSessionTools = (
  readWebsearchConfig: () => WebsearchConfig,
  mode: SessionMode,
): ToolAssembly => {
  const customTools: ToolDefinition[] = [
    createWebfetchTool(),
    createWebsearchTool(readWebsearchConfig),
    // 计划提交只在 plan 模式提供：它是「计划就绪」的信号，build / ask 用不到
    ...(mode === "plan" ? [createPresentPlanTool()] : []),
  ];
  return {
    tools: [...DEFAULT_BUILTIN_TOOLS, ...customTools.map((tool) => tool.name)],
    customTools,
  };
};
