/**
 * 能力解析：把「父会话能力」与「子角色声明」取交集，产出装配层直接消费的 `ResolvedCapability`。
 *
 * 交集是这套机制的底座：子会话只能用父会话也有的工具、只能命中父会话也允许的权限，
 * 保证「计划模式只读」这样的父约束不会因为委派子角色而被放宽。
 */
import { DEFAULT_SESSION_MODE } from "@ucode/contracts";

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

/** primary 能力解析：没有父会话，直接用角色声明值 */
export const primaryCapability = (slug: string, registry?: AgentRegistry): ResolvedCapability => {
  const profile = primaryProfile(slug, registry);
  return {
    toolSelection: profile.capability.toolSelection as ToolSelection,
    excludeTools: [],
    permissions: profile.capability.permissions,
    ...(profile.capability.model ? { model: profile.capability.model } : {}),
    ...(profile.capability.thinkingLevel
      ? { thinkingLevel: profile.capability.thinkingLevel }
      : {}),
  };
};

/** primary 角色的实际工具名，供提示词生成可用工具清单 */
export const primaryToolNames = (slug: string, registry?: AgentRegistry): string[] =>
  effectiveToolNames(primaryCapability(slug, registry));

/** 是否为「继承默认工具集」的能力：扩展工具（codemode / MCP）对它可见 */
export const usesDefaultToolSet = (capability: ResolvedCapability): boolean =>
  capability.toolSelection.kind === "defaultTools";

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
      ...(profile.capability.thinkingLevel
        ? { thinkingLevel: profile.capability.thinkingLevel }
        : {}),
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
    ...(profile.capability.thinkingLevel
      ? { thinkingLevel: profile.capability.thinkingLevel }
      : {}),
  };
};

export type { SubagentSlug };
