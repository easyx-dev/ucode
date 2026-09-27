/**
 * @ucode/ui —— 控制层共用 UI 层（React 组件与视图模型）。
 *
 * 三条边界（ADR-022 / spec §7.2）：
 * - 只依赖 `sdk`（headless）与 `protocol`，**不依赖任何 `apps/*`**——共享层不知道具体宿主；
 * - Web 与桌面共用它；**TUI 只复用 sdk**，不复用它（终端渲染与 DOM 渲染没有共同组件）；
 * - 宿主差异（窗口、托盘、通知、端口映射）留在各自的 `apps/*` 里。
 */
export { AgentShell } from "./app.tsx";
export { ErrorBoundary } from "./components/error-boundary.tsx";
export {
  composeFollowUpPrompt,
  DEFAULT_FOLLOW_UP,
  MAX_QUOTE_CHARS,
  quoteExcerpt,
} from "./components/follow-up.ts";
export {
  describeBucket,
  describePreflight,
  describeVersions,
  formatTokenCount,
  topModelRows,
} from "./components/insights-format.ts";
export { InsightsPanel } from "./components/insights-panel.tsx";
export {
  componentKindLabel,
  describeCatalogEntry,
  groupInstalled,
  type InstalledGroup,
  summarizeInstallReport,
} from "./components/marketplace-format.ts";
export { MarketplacePanel } from "./components/marketplace-panel.tsx";
export { Badge, Button, Card, Modal, Spinner } from "./components/primitives.tsx";
export {
  describeNextRun,
  describeRuns,
  describeSchedule,
  formatRelative,
  statusLabel,
  statusTone,
} from "./components/task-format.ts";
export { TasksPanel } from "./components/tasks-panel.tsx";
export { TerminalPanel } from "./components/terminal-panel.tsx";
export {
  buildTreeRows,
  changeStatusLabel,
  depthOf,
  fileIcon,
  filterTreeRows,
  formatBytes,
  isImagePath,
  sortChanges,
  type TreeRow,
} from "./components/workspace-format.ts";
export { WorkspacePanel } from "./components/workspace-panel.tsx";
export { AgentStoreProvider, useAgent, useAgentStore, useStickToBottom } from "./context.ts";
export type {
  AgentStore,
  AgentStoreState,
  InsightsState,
  MarketplaceState,
  WorkspaceState,
} from "./store.ts";
export {
  createAgentStore,
  emptyInsights,
  emptyMarketplace,
  emptyWorkspace,
} from "./store.ts";
export {
  Composer,
  EmptyState,
  InteractionDialog,
  SessionSidebar,
  StatusBar,
  TopBar,
  Transcript,
} from "./views.tsx";
