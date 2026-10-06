/**
 * 角色能力模型的类型：primary（build / plan / ask）与 subagent（general / explore / 自定义）共用。
 *
 * 「角色声明」与「与父会话取交集后的能力」分成两个类型：前者是静态数据，
 * 后者是装配层真正消费的结果，避免装配层再去理解 `inherit` 这类声明的语义。
 */
import type { AgentSource, ThinkingLevel } from "@ucode/contracts";

import type { PermissionRule } from "../permissions/engine";

/** 工具选择：直接对应 pi 会话参数的 `defaultTools`（默认集）与 `tools`（白名单） */
export type ToolSelection =
  | { kind: "defaultTools"; defaultTools: string[] }
  | { kind: "allowlist"; tools: string[] };

/** 角色声明的能力（尚未与父会话取交集） */
export type AgentCapability = {
  /** 工具档位；`inherit` 表示沿用父会话解析后的工具集（general 用） */
  toolSelection: ToolSelection | { kind: "inherit" };
  /** 角色附加的权限规则 */
  permissions: readonly PermissionRule[];
  /** 覆盖模型；缺省继承父会话 */
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/** 与父会话取交集后的能力：工具选择已确定，`excludeTools` 兜住 pi 侧内置 / 扩展工具 */
export type ResolvedCapability = {
  toolSelection: ToolSelection;
  excludeTools: readonly string[];
  permissions: readonly PermissionRule[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/** 角色定义；主会话角色即原来的「模式」，子角色是它的子集形态 */
export type AgentProfile = {
  slug: string;
  kind: "primary" | "subagent";
  /** 展示名（界面文案）；模型看到的是 `description` */
  label: string;
  /** 供 `subagent` 工具描述与后续广告位使用 */
  description: string;
  /** 自定义角色的提示词正文；内置角色缺省由语言目录按 slug 提供 */
  promptSection?: string;
  capability: AgentCapability;
  /** 是否列进 `subagent` 工具的角色广告；缺省为是，显式 `false` 表示隐藏但仍可按名调用 */
  advertise?: boolean;
  /** 是否对选择器隐藏（自定义 primary）；隐藏项仍可按名调用 */
  hidden?: boolean;
  /** 自定义角色的来源；内置角色缺省 */
  source?: AgentSource;
};
