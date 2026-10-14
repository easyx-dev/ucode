/**
 * 内置角色注册表：primary（build / plan / ask）与 subagent（general / explore）。
 *
 * primary 与子角色的能力在这里以同一形状声明；与父会话取交集的逻辑见 `capability.ts`。
 * 模式约束文案不放这里（按语言存放在 `harness/setup/prompt/locales`），这里只管能力。
 */
import type { SessionMode, ThinkingLevel } from "@ucode/contracts";

import { DEFAULT_PERMISSION_RULES, type PermissionRule } from "../permissions";
import {
  DEFAULT_BUILTIN_TOOLS,
  DEFAULT_EXTENSION_TOOLS,
  isExecTool,
  PRESENT_PLAN_TOOL_NAME,
  READ_ONLY_TOOLS,
  SUBAGENT_TOOL_NAME,
  WRITE_TOOLS,
} from "../tools/names";
import type { AgentProfile, ToolSelection } from "./types";

/** 内置子角色 slug；自定义角色是运行时数据，不进这个联合 */
export const SUBAGENT_SLUGS = ["general", "explore"] as const;

export type SubagentSlug = (typeof SUBAGENT_SLUGS)[number];

/**
 * 只读角色的闸门规则：写盘与执行一律阻断。
 *
 * 计划 / 问答的**工具声明与编码一致**（见下面的 PRIMARY_PROFILES），只读性完全由这几条规则在
 * `tool_call` 上落地：切模式不改模型的工具表，也就不会出现「模型照上一轮的旧工具表回答」；
 * 阻断不受权限档位影响（`deny` 永不放宽，见 permissions/engine 的 applyApprovalMode）。
 */
const READ_ONLY_PERMISSIONS: readonly PermissionRule[] = WRITE_TOOLS.map((tool) => ({
  tool,
  pattern: "*",
  action: "deny" as const,
  note: isExecTool(tool) ? "只读角色不允许执行命令" : "只读角色不允许改文件",
}));

/** 默认集的内置部分：内置工具 + 内置扩展（自研工具经 customTools 注册，不列在这里） */
const DEFAULT_TOOL_NAMES = [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS];

/** build 的默认工具集：只读模式的声明与它一致，差异只在只读那一侧多一个 present_plan */
const BUILD_TOOLS: ToolSelection = { kind: "defaultTools", defaultTools: DEFAULT_TOOL_NAMES };

/** 计划模式的工具集：与编码同一份，只多一个提交计划的收尾工具（见上面的注释） */
const PLAN_TOOLS: ToolSelection = {
  kind: "defaultTools",
  defaultTools: [...DEFAULT_TOOL_NAMES, PRESENT_PLAN_TOOL_NAME],
};

const readOnlySelection = (extra: readonly string[] = []): ToolSelection => ({
  kind: "allowlist",
  tools: [...READ_ONLY_TOOLS, ...extra],
});

const primary = (
  slug: SessionMode,
  label: string,
  toolSelection: ToolSelection,
  permissions: readonly PermissionRule[],
  /** 本模式的推荐思考档位：档位偏好为 `auto` 时采用；缺省落到 `DEFAULT_RECOMMENDED_THINKING_LEVEL` */
  recommendedThinkingLevel?: ThinkingLevel,
): AgentProfile => ({
  slug,
  kind: "primary",
  label,
  description: "",
  capability: { toolSelection, permissions },
  ...(recommendedThinkingLevel ? { recommendedThinkingLevel } : {}),
});

export const PRIMARY_PROFILES: Record<SessionMode, AgentProfile> = {
  // 编码以执行步为主，推荐比计划低一档；问答更轻——偏好为 auto 时按这里跑，
  // 会话里显式选过档位就以会话的为准（见 harness/setup/session-config）
  build: primary("build", "编码", BUILD_TOOLS, [], "xhigh"),
  // 计划只比编码多一个 present_plan（提交计划的信号）；调研要出方案，推荐取最高档。
  // 工具声明刻意不收窄：它由 READ_ONLY_PERMISSIONS 在调用时阻断（连同子会话与 codemode 的嵌套调用）
  plan: primary("plan", "计划", PLAN_TOOLS, READ_ONLY_PERMISSIONS, "max"),
  ask: primary("ask", "问答", BUILD_TOOLS, READ_ONLY_PERMISSIONS, "medium"),
};

export const SUBAGENT_PROFILES: Record<SubagentSlug, AgentProfile> = {
  general: {
    slug: "general",
    kind: "subagent",
    label: "通用子智能体",
    description:
      "继承当前会话能力的通用子智能体。适合把一段独立、可自证的任务交给它完成，" +
      "它在同一个工作目录里干活并只把最终结论带回；看不到当前对话，任务要写完整。",
    capability: { toolSelection: { kind: "inherit" }, permissions: [] },
  },
  explore: {
    slug: "explore",
    kind: "subagent",
    label: "只读侦察",
    description:
      "只读子智能体。适合代码库侦察、影响面分析、方案评审与资料查找，不改文件、不执行命令，" +
      "只把结论带回来；看不到当前对话，任务要写完整。",
    capability: { toolSelection: readOnlySelection(), permissions: READ_ONLY_PERMISSIONS },
  },
};

export const ALL_PROFILES: Record<string, AgentProfile> = {
  ...PRIMARY_PROFILES,
  ...SUBAGENT_PROFILES,
};

/** 默认子角色：模型未指定 agent 时用它（继承父能力，最不容易用错） */
export const DEFAULT_SUBAGENT_SLUG: SubagentSlug = "general";

/** 角色的完整权限规则：全局默认在前，角色规则与「子会话禁递归」在后 */
export const agentRules = (profile: AgentProfile): PermissionRule[] => [
  ...DEFAULT_PERMISSION_RULES,
  ...profile.capability.permissions,
  ...(profile.kind === "subagent"
    ? [
        {
          tool: SUBAGENT_TOOL_NAME,
          pattern: "*",
          action: "deny" as const,
          note: "子会话不能再派子会话",
        },
      ]
    : []),
];
