/**
 * 工具名清单：内置 / 扩展 / 自研与只读集。
 *
 * 模式与角色声明、装配层、提示词共用同一份名字，避免「声明与注册成对维护」的隐性耦合。
 */

import { BROWSER_TOOL_NAMES } from "../../features/browser/tools";
import { MEMORY_TOOL_NAMES } from "../../features/memory/tools";
import { GOAL_BLOCKED_TOOL, GOAL_COMPLETE_TOOL } from "./goal";

/** PowerShell 工具名：pi 只在 Windows 上提供它（`getPowerShellConfig` 在别的平台直接抛错） */
export const POWERSHELL_TOOL_NAME = "powershell";

/**
 * 内置工具：读写执行 + 只读检索（grep / find / ls）；Windows 上另有 PowerShell 通道。
 *
 * 按平台组这份清单是必须的：它会被原样 `applyOverrides({ defaultTools })` 交给 pi 装配，
 * 在非 Windows 上多列一个 powershell 会让整轮装配失败。
 */
export const DEFAULT_BUILTIN_TOOLS: readonly string[] = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  ...(process.platform === "win32" ? [POWERSHELL_TOOL_NAME] : []),
];

/** 内置扩展工具：注册即存在但不默认激活，由默认集一并开启 */
export const DEFAULT_EXTENSION_TOOLS = ["codemode"];

/** 自研工具名：经 `customTools` 注册即启用，默认集的提示词与可用清单要单独补上 */
export const CUSTOM_TOOL_NAMES = ["webfetch", "websearch", "question", "subagent"] as const;

/**
 * 目标模式的结算工具名。不进 `CUSTOM_TOOL_NAMES`——那是无条件注册，
 * 而它只在会话有 active 目标时才挂（见 `session-config`）。
 */
export const GOAL_TOOL_NAMES = [GOAL_COMPLETE_TOOL, GOAL_BLOCKED_TOOL] as const;

/** 只读能力集：读文件、检索与提问，不含任何写盘 / 执行能力 */
export const READ_ONLY_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "webfetch",
  "websearch",
  "question",
] as const;

/** 子智能体工具名；primary 把它暴露给模型，子会话恒不注册（防递归） */
export const SUBAGENT_TOOL_NAME = "subagent";

/** 计划模式的收尾工具名：只在计划模式注册，调用即提交方案、本轮结束 */
export const PRESENT_PLAN_TOOL_NAME = "present_plan";

/** 执行命令的工具名：与写盘同属「改变机器状态」，只读角色一并断掉 */
export const EXEC_TOOL_NAMES = ["bash", POWERSHELL_TOOL_NAME] as const;

/** 是否属于执行命令的工具：只读角色的规则文案要把它与写盘分开说 */
export const isExecTool = (name: string): boolean =>
  (EXEC_TOOL_NAMES as readonly string[]).includes(name);

/**
 * 会写盘 / 执行命令 / 操作浏览器的工具名：只读角色用规则把它们整批断掉
 * （见 `harness/setup/agents/profiles`）。浏览器能起进程、能出网、能读本地文件，与执行命令同档。
 */
export const WRITE_TOOLS = ["edit", "write", ...EXEC_TOOL_NAMES, ...BROWSER_TOOL_NAMES] as const;

/** 子会话永远拿不到的工具：递归、计划提交、记忆写入与目标结算（子会话不该结算父目标） */
export const SUBAGENT_EXCLUDED_TOOLS = [
  SUBAGENT_TOOL_NAME,
  PRESENT_PLAN_TOOL_NAME,
  "remember",
  "forget",
  ...GOAL_TOOL_NAMES,
] as const;

/**
 * 全部已知工具名：校验自定义角色 `tools` 声明的白名单，把拼写错误挡在装配之前。
 * 自定义角色只能收窄能力，列错名字会静默少一个工具，所以这里宁可报错也不要放过。
 */
export const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...DEFAULT_BUILTIN_TOOLS,
  ...DEFAULT_EXTENSION_TOOLS,
  ...CUSTOM_TOOL_NAMES,
  ...READ_ONLY_TOOLS,
  PRESENT_PLAN_TOOL_NAME,
  "tool_search",
  ...BROWSER_TOOL_NAMES,
  ...MEMORY_TOOL_NAMES,
  ...GOAL_TOOL_NAMES,
]);
