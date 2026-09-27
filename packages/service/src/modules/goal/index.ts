export { createGoalExtension, type GoalExtensionOptions } from "./extension.ts";
export {
  buildGoalPrompt,
  createGoalState,
  DEFAULT_MAX_CONTINUATIONS,
  GOAL_CUSTOM_TYPE,
  type GoalEntryLike,
  type GoalState,
  type GoalStatus,
  parseGoalState,
  restoreGoal,
} from "./state.ts";
export { type VerifyOptions, verifyGoalCompletion } from "./verify.ts";
