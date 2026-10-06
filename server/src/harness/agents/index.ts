/** 角色注册表与能力解析的统一出口（见 `plans/stage-7c-subagents.md`）。 */

export {
  effectiveToolNames,
  hasPrimaryMode,
  primaryCapability,
  primaryProfile,
  primaryToolNames,
  resolveSubagentCapability,
  subagentProfile,
  usesDefaultToolSet,
} from "./capability";
export {
  type AgentRegistry,
  type AgentRegistryInput,
  allSubagents,
  type CustomAgentError,
  type CustomAgentMode,
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
