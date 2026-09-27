import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "./components/error-boundary.tsx";
import { InsightsPanel } from "./components/insights-panel.tsx";
import { MarketplacePanel } from "./components/marketplace-panel.tsx";
import { ModelConfigDialog } from "./components/model-config-dialog.tsx";
import { TasksPanel } from "./components/tasks-panel.tsx";
import { TerminalPanel } from "./components/terminal-panel.tsx";
import { WorkspacePanel } from "./components/workspace-panel.tsx";
import { useAgentStore } from "./context.ts";
import {
  Composer,
  type ComposerPanel,
  EmptyState,
  InteractionDialog,
  SessionSidebar,
  StatusBar,
  TopBar,
  Transcript,
} from "./views.tsx";

/**
 * 控制层壳子的整体视图（Web 与桌面共用）。
 *
 * 只依赖 `@ucode/sdk` 的折叠结果：换宿主（浏览器 / Electron）时这一层不用改——
 * 宿主差异（窗口、托盘、通知、端口映射）留在各自的 `apps/*` 里。
 */
export type AgentShellProps = {
  productName: string;
  /** 初始默认工作目录（新建会话用）。 */
  defaultCwd?: string;
};

export function AgentShell({ productName, defaultCwd }: AgentShellProps): ReactNode {
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const attachSession = useAgentStore((store) => store.attachSession);
  const bootError = useAgentStore((store) => store.bootError);
  const loadTasks = useAgentStore((store) => store.loadTasks);
  const activeSessionId = state.activeSessionId;
  const activeTasks = state.tasks.filter((task) => task.status === "active").length;
  const [initialized, setInitialized] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const loadWorkspace = useAgentStore((store) => store.loadWorkspace);
  const loadMarketplace = useAgentStore((store) => store.loadMarketplace);
  const loadUsage = useAgentStore((store) => store.loadUsage);

  /** 输入区的 `/` 命令与顶栏按钮走同一条路：都只是"把某个面板打开"。 */
  const openPanel = useCallback(
    (panel: ComposerPanel): void => {
      if (panel === "tasks") setTasksOpen(true);
      else if (panel === "plugins") {
        setMarketplaceOpen(true);
        void loadMarketplace();
      } else if (panel === "usage") {
        setInsightsOpen(true);
        void loadUsage();
      } else setModelConfigOpen(true);
    },
    [loadMarketplace, loadUsage],
  );

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    void loadTasks();
    if (state.sessions.length === 0 && state.connected) {
      void createSession(defaultCwd);
      return;
    }
    // 刷新页面后接回最近一个会话：壳子不该让用户每次重开都手动点一下。
    const recent = state.sessions[0];
    if (recent !== undefined && activeSessionId === null) {
      void attachSession(recent.id);
    }
  }, [
    attachSession,
    createSession,
    defaultCwd,
    initialized,
    loadTasks,
    state.connected,
    state.sessions,
    activeSessionId,
  ]);

  return (
    <div className="flex h-full">
      <SessionSidebar productName={productName} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onToggleTerminal={() => setTerminalOpen((current) => !current)}
          onToggleTasks={() => setTasksOpen((current) => !current)}
          onToggleWorkspace={() => {
            setWorkspaceOpen((current) => !current);
            if (!workspaceOpen && activeSessionId !== null) void loadWorkspace(activeSessionId);
          }}
          onToggleMarketplace={() => {
            setMarketplaceOpen((current) => !current);
            if (!marketplaceOpen) void loadMarketplace();
          }}
          onToggleInsights={() => {
            setInsightsOpen((current) => !current);
            if (!insightsOpen) void loadUsage();
          }}
          onOpenModelConfig={() => setModelConfigOpen(true)}
          activeTasks={activeTasks}
        />
        {bootError !== null && (
          <div className="border-b border-[var(--color-border-subtle)] bg-[oklch(0.3_0.06_25)] px-3 py-1.5 text-xs text-[var(--color-danger)]">
            {bootError}
          </div>
        )}
        {activeSessionId === null ? (
          <EmptyState onCreate={() => void createSession(defaultCwd)} productName={productName} />
        ) : (
          <>
            <ErrorBoundary label="会话视图">
              <Transcript sessionId={activeSessionId} />
            </ErrorBoundary>
            {terminalOpen && (
              <ErrorBoundary label="终端">
                <TerminalPanel sessionId={activeSessionId} onClose={() => setTerminalOpen(false)} />
              </ErrorBoundary>
            )}
            <ErrorBoundary label="输入区">
              <Composer
                sessionId={activeSessionId}
                productName={productName}
                onOpenPanel={openPanel}
              />
            </ErrorBoundary>
          </>
        )}
        <StatusBar />
      </main>
      {workspaceOpen && activeSessionId !== null && (
        <ErrorBoundary label="工作区面板">
          <WorkspacePanel sessionId={activeSessionId} onClose={() => setWorkspaceOpen(false)} />
        </ErrorBoundary>
      )}
      {tasksOpen && (
        <ErrorBoundary label="自动化面板">
          <TasksPanel onClose={() => setTasksOpen(false)} />
        </ErrorBoundary>
      )}
      {marketplaceOpen && (
        <ErrorBoundary label="插件市场面板">
          <MarketplacePanel onClose={() => setMarketplaceOpen(false)} />
        </ErrorBoundary>
      )}
      {insightsOpen && (
        <ErrorBoundary label="用量与数据面板">
          <InsightsPanel onClose={() => setInsightsOpen(false)} />
        </ErrorBoundary>
      )}
      {modelConfigOpen && (
        <ErrorBoundary label="模型配置">
          <ModelConfigDialog onClose={() => setModelConfigOpen(false)} />
        </ErrorBoundary>
      )}
      <InteractionDialog />
    </div>
  );
}
