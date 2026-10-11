/** 权限引擎：声明式规则（工具名 + pattern + 三态）与 `tool_call` 拦截 */
export { DEFAULT_PERMISSION_RULES, skillDirectoryRules } from "./defaults";
export {
  applyApprovalMode,
  decidePermission,
  evaluateRules,
  isExternal,
  matchPattern,
  type PermissionAsk,
  type PermissionRequest,
  type PermissionRule,
  type PermissionVerdict,
  type ToolTarget,
  toolTarget,
} from "./engine";
export {
  createPermissionExtension,
  type PermissionGate,
  type PermissionHooks,
} from "./extension";
export { SessionAllowStore } from "./session-allow";
