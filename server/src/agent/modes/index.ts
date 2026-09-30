/**
 * 助手模式：模式 = 能力三元组（工具白名单 + 权限规则 + 提示词片段）。
 *
 * 工作区、模式本身都挂在会话上，模式切换只影响会话实例的装配（见 `session-config`）。
 * `build` 用「全部可用工具」而不是显式枚举，避免新增工具时漏配；
 * `plan` / `ask` 是只读能力集，越权工具既不出现在白名单，也有阻断规则兜底。
 * plan 的「计划产出与决策」在后续接入 `present_plan` 时再补。
 */
import type { SessionMode } from "@ucode/contracts";

import { DEFAULT_PERMISSION_RULES, type PermissionRule } from "../permissions";

export type ModeDefinition = {
  slug: SessionMode;
  /** 工具白名单；`null` 表示沿用全部可用工具（含扩展工具） */
  tools: readonly string[] | null;
  /** 追加到系统提示词的模式片段（完整自研提示词在阶段 4） */
  prompt: string;
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
    tools: null,
    prompt: "当前处于「编码」模式：可以直接读写文件、执行命令来完成用户的任务。",
    permissions: [],
  },
  plan: {
    slug: "plan",
    tools: [...READ_ONLY_TOOLS, "present_plan"],
    prompt:
      "当前处于「计划」模式：只做只读调研，产出可执行的方案；不要修改文件或执行命令。" +
      "调研完成后，把计划写在回复里，并以 present_plan 收尾；需要用户确认的点写进计划，不要用提问收尾。",
    permissions: READ_ONLY_PERMISSIONS,
  },
  ask: {
    slug: "ask",
    tools: READ_ONLY_TOOLS,
    prompt: "当前处于「问答」模式：只做只读分析与回答，不要修改文件或执行命令。",
    permissions: READ_ONLY_PERMISSIONS,
  },
};

/** 模式的完整权限规则：全局默认在前，模式规则在后（可覆盖默认） */
export const rulesForMode = (mode: SessionMode): PermissionRule[] => [
  ...DEFAULT_PERMISSION_RULES,
  ...MODES[mode].permissions,
];
