import { type ReactNode, useEffect, useState } from "react";
import { ErrorBoundary } from "./components/error-boundary.tsx";
import { useAgentStore } from "./context.ts";
import {
  Composer,
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
  const activeSessionId = state.activeSessionId;
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
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
    state.connected,
    state.sessions,
    activeSessionId,
  ]);

  return (
    <div className="flex h-full">
      <SessionSidebar productName={productName} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {bootError !== null && (
          <div className="border-b border-[var(--color-border-subtle)] bg-[oklch(0.3_0.06_25)] px-3 py-1.5 text-xs text-[var(--color-danger)]">
            {bootError}
          </div>
        )}
        {activeSessionId === null ? (
          <EmptyState onCreate={() => void createSession(defaultCwd)} />
        ) : (
          <ErrorBoundary label="会话视图">
            <Transcript sessionId={activeSessionId} />
            <Composer sessionId={activeSessionId} />
          </ErrorBoundary>
        )}
        <StatusBar />
      </main>
      <InteractionDialog />
    </div>
  );
}
