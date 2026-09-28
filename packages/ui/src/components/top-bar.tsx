import type { ReactNode } from "react";
import { useAgentStore } from "../context.ts";
import {
  BoltIcon,
  CompressIcon,
  FolderIcon,
  GaugeIcon,
  PackageIcon,
  PanelIcon,
  StopIcon,
  TerminalIcon,
} from "./icons.tsx";
import { Badge, IconButton, Spinner } from "./primitives.tsx";
import { sessionTitle } from "./session-format.ts";

/**
 * 顶栏：**这一屏是什么**（标题 + 状态）+ **能开哪些面板**（右侧图标）。
 *
 * 与 ZCode 一致：模型、执行模式这类"随时会改的选择"不放这里（它们属于输入区，
 * 手在键盘上时不该去右上角找），顶栏只留"看到"与"开关"。
 */

export type ShellPanel = "workspace" | "terminal" | "tasks" | "plugins" | "usage";

export type TopBarProps = {
  /** 各面板的开启状态（图标据此显示激活态）。 */
  openPanels: Record<ShellPanel, boolean>;
  onTogglePanel: (panel: ShellPanel) => void;
  onToggleSidebar?: () => void;
  /** 活跃自动化任务数（>0 时在"自动化"上带角标）。 */
  activeTasks?: number;
};

export function TopBar({
  openPanels,
  onTogglePanel,
  onToggleSidebar,
  activeTasks = 0,
}: TopBarProps): ReactNode {
  const state = useAgentStore((store) => store.state);
  const compact = useAgentStore((store) => store.compact);
  const abort = useAgentStore((store) => store.abort);
  const sessionId = state.activeSessionId;
  const view = sessionId === null ? undefined : state.views[sessionId];
  const running = view?.running === true;
  // 标题与侧栏同一口径（名称 → 首条消息 → id 前缀）：同一个会话在两处叫不同名字，
  // 用户会先怀疑自己点错了会话，再去怀疑是不是打开了两份。
  const summary = state.sessions.find((session) => session.id === sessionId);
  const title = summary !== undefined ? sessionTitle(summary) : (view?.summary?.name ?? "会话");

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-2">
      {onToggleSidebar !== undefined && (
        <IconButton
          className="md:hidden"
          icon={<PanelIcon />}
          label="显示会话列表"
          onClick={onToggleSidebar}
        />
      )}
      <h1 className="min-w-0 truncate px-1 text-xs font-medium">{title}</h1>
      {!state.connected && <Badge tone="warn">未连接，正在重连</Badge>}
      {view?.readOnly === true && <Badge tone="warn">只读挂载</Badge>}
      {view?.state?.status === "waiting" && <Badge tone="warn">等待应答</Badge>}
      {running && (
        <span className="flex shrink-0 items-center gap-1.5 pl-1 text-[11px] text-[var(--color-accent)]">
          <Spinner />
          运行中
        </span>
      )}

      <div className="app-topbar-actions ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton
          icon={<FolderIcon />}
          label="工作区：文件树 / 变更 / 历史"
          active={openPanels.workspace}
          disabled={sessionId === null}
          onClick={() => onTogglePanel("workspace")}
        />
        <IconButton
          icon={<TerminalIcon />}
          label="终端（工作区 PTY）"
          active={openPanels.terminal}
          disabled={sessionId === null}
          onClick={() => onTogglePanel("terminal")}
        />
        <IconButton
          icon={<BoltIcon />}
          label={activeTasks > 0 ? `自动化（${activeTasks} 个活跃任务）` : "自动化"}
          active={openPanels.tasks}
          onClick={() => onTogglePanel("tasks")}
        />
        <IconButton
          icon={<PackageIcon />}
          label="插件与市场"
          active={openPanels.plugins}
          onClick={() => onTogglePanel("plugins")}
        />
        <IconButton
          icon={<GaugeIcon />}
          label="用量 / 支持包 / 迁移"
          active={openPanels.usage}
          onClick={() => onTogglePanel("usage")}
        />
        <span className="mx-1 h-4 w-px bg-[var(--color-border-subtle)]" />
        <IconButton
          icon={<CompressIcon />}
          label="压缩上下文"
          disabled={sessionId === null}
          onClick={() => sessionId !== null && void compact(sessionId)}
        />
        <IconButton
          icon={<StopIcon />}
          label="中止本轮"
          disabled={!running}
          onClick={() => sessionId !== null && void abort(sessionId)}
        />
      </div>
    </header>
  );
}
