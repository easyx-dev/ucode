/**
 * 工具名清单：内置 / 扩展 / 自研与只读集。
 *
 * 模式与角色声明、装配层、提示词共用同一份名字，避免「声明与注册成对维护」的隐性耦合。
 */
import { MEMORY_TOOL_NAMES } from "../memory/tools";

/** 内置工具：读写执行 + 只读检索（grep / find / ls） */
export const DEFAULT_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** 内置扩展工具：注册即存在但不默认激活，由默认集一并开启 */
export const DEFAULT_EXTENSION_TOOLS = ["codemode"];

/** 自研工具名：经 `customTools` 注册即启用，默认集的提示词与可用清单要单独补上 */
export const CUSTOM_TOOL_NAMES = ["webfetch", "websearch", "question", "subagent"] as const;

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

/** 子会话永远拿不到的工具：递归、计划提交与记忆写入 */
export const SUBAGENT_EXCLUDED_TOOLS = [
  SUBAGENT_TOOL_NAME,
  "present_plan",
  "remember",
  "forget",
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
  "present_plan",
  "tool_search",
  ...MEMORY_TOOL_NAMES,
]);
