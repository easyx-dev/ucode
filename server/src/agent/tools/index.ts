/**
 * 工具集声明：内置工具清单（供模式声明的默认集使用）与自研工具装配。
 *
 * 「本次会话启用哪些工具」由 `modes` 声明（`toolSelection`），这里只负责产出 `customTools`。
 * pi 的 `tools` 是白名单，plan / ask 下自研工具漏进白名单就会被过滤，
 * 所以 `MODES` 声明的只读集与这里的工具名必须成对维护。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SessionMode, WebsearchConfig } from "@ucode/contracts";

import { createPresentPlanTool } from "./present-plan";
import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch/index";

/** 内置工具：读写执行 + 只读检索（grep / find / ls） */
export const DEFAULT_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** 内置扩展工具：注册即存在但不默认激活，由 `build` 的默认集一并开启 */
export const DEFAULT_EXTENSION_TOOLS = ["codemode"];

/** 自研工具名：经 `customTools` 注册即启用，不在 `defaultTools` 里，默认集的提示词要单独补上 */
export const CUSTOM_TOOL_NAMES = ["webfetch", "websearch"] as const;

export const buildCustomTools = (
  readWebsearchConfig: () => WebsearchConfig,
  mode: SessionMode,
): ToolDefinition[] => [
  createWebfetchTool(),
  createWebsearchTool(readWebsearchConfig),
  // 计划提交只在 plan 模式提供：它是「计划就绪」的信号，build / ask 用不到
  ...(mode === "plan" ? [createPresentPlanTool()] : []),
];
