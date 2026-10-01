/**
 * 助手模式：模式 = 能力三元组（工具选择 + 权限规则 + 提示词约束）。
 *
 * 提示词约束按模式存放在 `agent/prompt` 的语言目录里（多语言口子），这里只管工具与权限。
 * 工作区、模式本身都挂在会话上，模式切换只影响会话实例的装配（见 `session-config`）。
 * `build` 走 `defaultTools`（内置工具 + 内置扩展，pi 扩展 / MCP 注册的工具保持默认启用）；
 * `plan` / `ask` 是只读能力集，用显式白名单，越权工具既不在选择里，也有阻断规则兜底。
 */
import type { SessionMode } from "@ucode/contracts";

import { DEFAULT_PERMISSION_RULES, type PermissionRule } from "../permissions";
import { CUSTOM_TOOL_NAMES, DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "../tools";

/** 工具选择：直接对应 pi 会话参数的 `defaultTools`（默认集）与 `tools`（白名单） */
export type ToolSelection =
  | { kind: "defaultTools"; defaultTools: string[] }
  | { kind: "allowlist"; tools: string[] };

export type ModeDefinition = {
  slug: SessionMode;
  /** 本次会话启用哪些工具 */
  toolSelection: ToolSelection;
  /** 在默认规则之后附加；最后命中者胜，所以可覆盖默认 */
  permissions: readonly PermissionRule[];
};

/** 只读能力集：读文件与检索，不含任何写盘 / 执行能力 */
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "webfetch", "websearch"] as const;

/** 只读模式的兜底规则：白名单已不含这些工具，规则作为第二道闸门 */
const READ_ONLY_PERMISSIONS: readonly PermissionRule[] = [
  { tool: "edit", pattern: "*", action: "deny", note: "只读模式不允许改文件" },
  { tool: "write", pattern: "*", action: "deny", note: "只读模式不允许改文件" },
  { tool: "bash", pattern: "*", action: "deny", note: "只读模式不允许执行命令" },
];

export const MODES: Record<SessionMode, ModeDefinition> = {
  build: {
    slug: "build",
    toolSelection: {
      kind: "defaultTools",
      defaultTools: [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS],
    },
    permissions: [],
  },
  plan: {
    slug: "plan",
    toolSelection: { kind: "allowlist", tools: [...READ_ONLY_TOOLS, "present_plan"] },
    permissions: READ_ONLY_PERMISSIONS,
  },
  ask: {
    slug: "ask",
    toolSelection: { kind: "allowlist", tools: [...READ_ONLY_TOOLS] },
    permissions: READ_ONLY_PERMISSIONS,
  },
};

/**
 * 某模式下实际可用的工具名：默认集要补上自研工具（它们经 `customTools` 注册即启用，
 * 不列在 `defaultTools` 里）；白名单本就显式列出，直接照搬。
 */
export const toolsForMode = (mode: SessionMode): string[] => {
  const { toolSelection } = MODES[mode];
  return toolSelection.kind === "defaultTools"
    ? [...toolSelection.defaultTools, ...CUSTOM_TOOL_NAMES]
    : [...toolSelection.tools];
};

/** 模式的完整权限规则：全局默认在前，模式规则在后（可覆盖默认） */
export const rulesForMode = (mode: SessionMode): PermissionRule[] => [
  ...DEFAULT_PERMISSION_RULES,
  ...MODES[mode].permissions,
];
