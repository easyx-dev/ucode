/**
 * 能力解析：把「父会话能力」与「子角色声明」取交集，产出装配层直接消费的 `ResolvedCapability`。
 *
 * 交集是这套机制的底座：子会话只能用父会话也有的工具、只能命中父会话也允许的权限，
 * 保证「计划模式只读」这样的父约束不会因为委派子角色而被放宽。
 */
import {
  DEFAULT_SESSION_MODE,
  type ThinkingLevel,
  type ThinkingPreference,
} from "@ucode/contracts";

import { DEFAULT_RECOMMENDED_THINKING_LEVEL } from "../../constants";
import type { PermissionRule } from "../permissions";
import { CUSTOM_TOOL_NAMES, SUBAGENT_EXCLUDED_TOOLS } from "../tools/names";
import type { AgentRegistry } from "./custom";
import {
  ALL_PROFILES,
  DEFAULT_SUBAGENT_SLUG,
  PRIMARY_PROFILES,
  type SubagentSlug,
} from "./profiles";
import type { AgentProfile, ResolvedCapability, ToolSelection } from "./types";

/** 角色声明解析出的实际工具名（默认集要补上自研工具），再减去 `excludeTools` */
export const effectiveToolNames = (capability: ResolvedCapability): string[] => {
  const base =
    capability.toolSelection.kind === "defaultTools"
      ? [...capability.toolSelection.defaultTools, ...CUSTOM_TOOL_NAMES]
      : [...capability.toolSelection.tools];
  const excluded = new Set(capability.excludeTools);
  return base.filter((name) => !excluded.has(name));
};

/**
 * 解析 primary 角色：自定义（含覆盖内置）优先，其次内置三位；
 * 未知 slug 回落默认模式——删掉自定义文件后旧会话仍要能打开。
 */
export const primaryProfile = (slug: string, registry?: AgentRegistry): AgentProfile =>
  registry?.primary[slug] ??
  (PRIMARY_PROFILES as Record<string, AgentProfile>)[slug] ??
  PRIMARY_PROFILES[DEFAULT_SESSION_MODE];

/** 该 slug 是否为可用的 primary（内置或已注册的自定义） */
export const hasPrimaryMode = (slug: string, registry?: AgentRegistry): boolean =>
  Object.hasOwn(registry?.primary ?? {}, slug) || Object.hasOwn(PRIMARY_PROFILES, slug);

/**
 * 本模式的推荐思考档位：即档位偏好为 `auto` 时的解析结果。
 * 子会话行的 `mode` 就是父的 mode，所以委派出去的会话也按这里解析（不看子角色自身的声明）。
 */
export const recommendedThinkingLevelOf = (slug: string, registry?: AgentRegistry): ThinkingLevel =>
  primaryProfile(slug, registry).recommendedThinkingLevel ?? DEFAULT_RECOMMENDED_THINKING_LEVEL;

/** 档位偏好 → 实际注入 pi 的档位：`auto` 按本会话模式的推荐值解开 */
export const resolveThinkingLevel = (
  preference: ThinkingPreference,
  mode: string,
  registry?: AgentRegistry,
): ThinkingLevel =>
  preference === "auto" ? recommendedThinkingLevelOf(mode, registry) : preference;

/** primary 能力解析：没有父会话，直接用角色声明值 */
export const primaryCapability = (slug: string, registry?: AgentRegistry): ResolvedCapability => {
  const profile = primaryProfile(slug, registry);
  return {
    toolSelection: profile.capability.toolSelection as ToolSelection,
    excludeTools: [],
    permissions: profile.capability.permissions,
    ...(profile.capability.model ? { model: profile.capability.model } : {}),
  };
};

/** primary 角色的实际工具名，供提示词生成可用工具清单 */
export const primaryToolNames = (slug: string, registry?: AgentRegistry): string[] =>
  effectiveToolNames(primaryCapability(slug, registry));

/** 是否为「继承默认工具集」的能力：扩展工具（codemode / MCP）对它可见 */
export const usesDefaultToolSet = (capability: ResolvedCapability): boolean =>
  capability.toolSelection.kind === "defaultTools";

/**
 * 父会话施加到子会话上的规则：只取模式声明的那部分，即「父会话的能力上限」。
 *
 * 全局默认规则（含 `external_directory` 的 ask）不在这里重复施加：子会话自己的规则里已有一份，
 * 重复施加会让用户已放行的范围（「本会话恒允」、技能目录）在子会话判定里重新落回审批。
 */
export const parentModeRules = (
  slug: string,
  registry?: AgentRegistry,
): readonly PermissionRule[] => primaryProfile(slug, registry).capability.permissions;

/**
 * 按 slug 取子角色；未知 slug 直接报错，避免静默退回默认角色。
 * 传入注册表时从中解析（含自定义角色），缺省只在内置集合里查，供不依赖 `harnessDir` 的调用方使用。
 */
export const subagentProfile = (slug?: string, registry?: AgentRegistry): AgentProfile => {
  const target = slug ?? DEFAULT_SUBAGENT_SLUG;
  const profile = registry ? registry.subagents[target] : ALL_PROFILES[target];
  if (profile?.kind !== "subagent") {
    throw new Error(`未知的子智能体角色：${target}`);
  }
  return profile;
};

/**
 * 与父会话取交集：
 * - `inherit` 且父是默认集时保留默认集（扩展 / MCP 注册的工具不被白名单屏蔽），靠 `excludeTools` 去掉递归工具；
 * - 其余情况把两者解析成工具名后取交集，落成显式白名单。
 */
export const resolveSubagentCapability = (
  profile: AgentProfile,
  parent: ResolvedCapability,
): ResolvedCapability => {
  const excluded = [...SUBAGENT_EXCLUDED_TOOLS];
  const own = profile.capability.toolSelection;

  if (own.kind === "inherit" && parent.toolSelection.kind === "defaultTools") {
    return {
      toolSelection: parent.toolSelection,
      excludeTools: excluded,
      permissions: profile.capability.permissions,
      ...(profile.capability.model ? { model: profile.capability.model } : {}),
    };
  }

  const declared: ToolSelection = own.kind === "inherit" ? parent.toolSelection : own;
  const parentNames = new Set(effectiveToolNames(parent));
  const names = effectiveToolNames({
    toolSelection: declared,
    excludeTools: excluded,
    permissions: [],
  }).filter((name) => parentNames.has(name));

  return {
    toolSelection: { kind: "allowlist", tools: names },
    excludeTools: excluded,
    permissions: profile.capability.permissions,
    ...(profile.capability.model ? { model: profile.capability.model } : {}),
  };
};

export type { SubagentSlug };
