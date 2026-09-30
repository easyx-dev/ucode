/**
 * 工具集装配：pi 内置工具的白名单与自研工具（webfetch / websearch）的汇入点。
 *
 * pi 的 `tools` 是**白名单**：只有列进去的工具才启用，自研工具不在其中同样会被过滤掉，
 * 所以内置清单与自研工具名必须成对维护——由 `buildSessionTools` 统一输出，别再各处手写。
 * 模式化的工具集在阶段 2 接管（按 mode 取这份清单的子集），届时白名单从 `modes/` 传入。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { WebsearchConfig } from "@ucode/contracts";

import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch/index";

/** 阶段 1 的内置工具：读写执行 + 只读检索（grep / find / ls） */
export const DEFAULT_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export type ToolAssembly = {
  /** 传给 `createAgentSession` 的工具白名单，含自研工具名 */
  tools: string[];
  /** 自研工具定义，随 `customTools` 注入 */
  customTools: ToolDefinition[];
};

export const buildSessionTools = (readWebsearchConfig: () => WebsearchConfig): ToolAssembly => {
  const customTools: ToolDefinition[] = [
    createWebfetchTool(),
    createWebsearchTool(readWebsearchConfig),
  ];
  return {
    tools: [...DEFAULT_BUILTIN_TOOLS, ...customTools.map((tool) => tool.name)],
    customTools,
  };
};
