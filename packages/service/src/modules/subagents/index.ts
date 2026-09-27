export {
  agentsDirFor,
  findProfile,
  type LoadProfilesResult,
  loadSubagentProfiles,
} from "./discovery.ts";
export {
  createSubagentsExtension,
  type SubagentsExtensionOptions,
} from "./extension.ts";
export {
  BUILTIN_PROFILES,
  isSafeSubagentName,
  parseSubagentProfile,
  SUBAGENT_NAME_PATTERN,
  type SubagentProfile,
} from "./profile.ts";
export {
  runSubagent,
  type SubagentRunOptions,
  type SubagentRunResult,
} from "./runner.ts";
