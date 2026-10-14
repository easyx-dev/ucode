/** 子智能体运行时的统一出口。 */
export { resolveContextPlan, type SubagentContextPlan } from "./context";
export { type SubagentSlot, SubagentSlots } from "./slots";
export { type SubagentSpawnDeps, spawnSubagent } from "./spawn";
export { createSubagentTool } from "./tool";
export {
  DEFAULT_SUBAGENT_CONTEXT,
  type SubagentContextStrategy,
  type SubagentHooks,
  type SubagentRequest,
  type SubagentResult,
} from "./types";
