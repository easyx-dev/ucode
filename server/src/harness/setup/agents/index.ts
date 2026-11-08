/** 角色注册表与能力解析的统一出口。 */

export {
  canWriteHarnessState,
  effectiveToolNames,
  hasPrimaryMode,
  isReadOnlyCapability,
  parentModeRules,
  primaryCapability,
  primaryProfile,
  primaryToolNames,
  recommendedThinkingLevelOf,
  resolveSubagentCapability,
  resolveThinkingLevel,
  subagentProfile,
  usesDefaultToolSet,
} from "./capability";
export {
  type AgentRegistry,
  type AgentRegistryInput,
  agentDirs,
  allSubagents,
  assertLoadableAgent,
  type CustomAgentError,
  type CustomAgentMode,
  isUsableAgentSlug,
  loadAgentRegistry,
  type ParsedCustomAgent,
  parseCustomAgent,
} from "./custom";
export {
  ALL_PROFILES,
  agentRules,
  DEFAULT_SUBAGENT_SLUG,
  PRIMARY_PROFILES,
  SUBAGENT_PROFILES,
  SUBAGENT_SLUGS,
  type SubagentSlug,
} from "./profiles";
export type {
  AgentCapability,
  AgentProfile,
  ResolvedCapability,
  ToolSelection,
} from "./types";
