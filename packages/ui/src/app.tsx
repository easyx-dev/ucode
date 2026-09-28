import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Composer, type ComposerPanel } from "./components/composer.tsx";
import { EmptyState } from "./components/empty-state.tsx";
import { ErrorBoundary } from "./components/error-boundary.tsx";
import { InsightsPanel } from "./components/insights-panel.tsx";
import { InteractionDialog } from "./components/interaction-dialog.tsx";
import { MarketplacePanel } from "./components/marketplace-panel.tsx";
import { ModelConfigDialog } from "./components/model-config-dialog.tsx";
import { SessionSidebar } from "./components/session-sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { TasksPanel } from "./components/tasks-panel.tsx";
import { TerminalPanel } from "./components/terminal-panel.tsx";
import { type ShellPanel, TopBar } from "./components/top-bar.tsx";
import { Transcript } from "./components/transcript.tsx";
import { WorkspacePanel } from "./components/workspace-panel.tsx";
import { useAgentStore } from "./context.ts";

/**
 * 控制层壳子的整体视图（Web 与桌面共用）。
 *
 * 布局按 ZCode 的三栏：左侧会话栏（导航 + 按项目分组的会话）、中间一列（转录 + 输入区）、
 * 右侧按需展开的面板。只依赖 `@ucode/sdk` 的折叠结果——换宿主（浏览器 / Electron）时
 * 这一层不用改，宿主差异（窗口、托盘、通知、端口映射）留在各自的 `apps/*` 里。
 */
export type AgentShellProps = {
  productName: string;
  /** 初始默认工作目录（新建会话用）。 */
  defaultCwd?: string;
};

const PANELS_CLOSED: Record<ShellPanel, boolean> = {
  workspace: false,
  terminal: false,
  tasks: false,
  plugins: false,
  usage: false,
};

export function AgentShell({ productName, defaultCwd }: AgentShellProps): ReactNode {
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const attachSession = useAgentStore((store) => store.attachSession);
  const bootError = useAgentStore((store) => store.bootError);
  const loadTasks = useAgentStore((store) => store.loadTasks);
  const loadWorkspace = useAgentStore((store) => store.loadWorkspace);
  const loadMarketplace = useAgentStore((store) => store.loadMarketplace);
  const loadUsage = useAgentStore((store) => store.loadUsage);
  const activeSessionId = state.activeSessionId;
  const activeTasks = state.tasks.filter((task) => task.status === "active").length;
  const [initialized, setInitialized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panels, setPanels] = useState<Record<ShellPanel, boolean>>(PANELS_CLOSED);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);

  /** 打开面板的同时把它的数据拉一遍（面板自己只负责展示，不负责"什么时候去取"）。 */
  const togglePanel = useCallback(
    (panel: ShellPanel): void => {
      setPanels((current) => ({ ...current, [panel]: !current[panel] }));
      if (panels[panel]) return;
      if (panel === "workspace" && activeSessionId !== null) void loadWorkspace(activeSessionId);
      if (panel === "plugins") void loadMarketplace();
      if (panel === "usage") void loadUsage();
    },
    [activeSessionId, loadMarketplace, loadUsage, loadWorkspace, panels],
  );

  /** 输入区的 `/` 命令与顶栏按钮走同一条路：都只是"把某个面板打开"。 */
  const openPanel = useCallback(
    (panel: ComposerPanel): void => {
      if (panel === "model") {
        setModelConfigOpen(true);
        return;
      }
      const target: ShellPanel =
        panel === "tasks" ? "tasks" : panel === "plugins" ? "plugins" : "usage";
      setPanels((current) => ({ ...current, [target]: true }));
      if (target === "plugins") void loadMarketplace();
      if (target === "usage") void loadUsage();
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
      <SessionSidebar
        productName={productName}
        defaultCwd={defaultCwd}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenTasks={() => togglePanel("tasks")}
        onOpenMarketplace={() => togglePanel("plugins")}
        onOpenModelConfig={() => setModelConfigOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          openPanels={panels}
          onTogglePanel={togglePanel}
          onToggleSidebar={() => setSidebarOpen(true)}
          activeTasks={activeTasks}
        />
        {bootError !== null && (
          <div className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[11px] text-[var(--color-danger)]">
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
            {panels.terminal && (
              <ErrorBoundary label="终端">
                <TerminalPanel
                  sessionId={activeSessionId}
                  onClose={() => togglePanel("terminal")}
                />
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
      {panels.workspace && activeSessionId !== null && (
        <ErrorBoundary label="工作区面板">
          <WorkspacePanel sessionId={activeSessionId} onClose={() => togglePanel("workspace")} />
        </ErrorBoundary>
      )}
      {panels.tasks && (
        <ErrorBoundary label="自动化面板">
          <TasksPanel onClose={() => togglePanel("tasks")} />
        </ErrorBoundary>
      )}
      {panels.plugins && (
        <ErrorBoundary label="插件市场面板">
          <MarketplacePanel onClose={() => togglePanel("plugins")} />
        </ErrorBoundary>
      )}
      {panels.usage && (
        <ErrorBoundary label="用量与数据面板">
          <InsightsPanel onClose={() => togglePanel("usage")} />
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
