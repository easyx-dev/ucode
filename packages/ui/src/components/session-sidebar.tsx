import type { SessionSummary } from "@ucode/sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "../context.ts";
import {
  ArchiveIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ForkIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
} from "./icons.tsx";
import { Badge, IconButton, Kbd } from "./primitives.tsx";
import {
  filterSessions,
  formatRelativeTime,
  groupSessionsByProject,
  type SessionTone,
  sessionSubtitle,
  sessionTitle,
  sessionTone,
} from "./session-format.ts";

/**
 * 会话侧栏（ZCode 的左侧一栏）。
 *
 * 三层结构，自上而下回答三个问题：**我能做什么**（导航）、**我做过什么**（按项目分组的会话）、
 * **我现在连着谁**（连接与信任）。搜索不再是常驻输入框，而是导航里的一项——
 * 常驻输入框会一直占着寸土寸金的宽度，而它在多数时候是空的。
 */

export type SessionSidebarProps = {
  productName: string;
  defaultCwd?: string;
  /** 窄屏下是否展开（覆盖层形态）；宽屏下侧栏常驻，这个值不起作用。 */
  isOpen?: boolean;
  onOpenTasks: () => void;
  onOpenMarketplace: () => void;
  onOpenModelConfig: () => void;
  onClose?: () => void;
};

const TONE_CLASSES: Record<SessionTone, string> = {
  running: "bg-[var(--color-accent)] animate-pulse",
  waiting: "bg-[var(--color-warn)]",
  readonly: "bg-[var(--color-content-faint)]",
  idle: "bg-[var(--color-border)]",
};

export function SessionSidebar({
  productName,
  defaultCwd,
  isOpen = false,
  onOpenTasks,
  onOpenMarketplace,
  onOpenModelConfig,
  onClose,
}: SessionSidebarProps): ReactNode {
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const attachSession = useAgentStore((store) => store.attachSession);
  const forkSession = useAgentStore((store) => store.forkSession);
  const archiveSession = useAgentStore((store) => store.archiveSession);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const search = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearching(true);
      } else if (key === "n") {
        event.preventDefault();
        void createSession(defaultCwd);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createSession, defaultCwd]);

  const visible = useMemo(
    () => filterSessions(state.sessions, query, showArchived),
    [state.sessions, query, showArchived],
  );
  const groups = useMemo(() => groupSessionsByProject(visible), [visible]);
  const now = Date.now();
  const archivedCount = state.sessions.filter((session) => session.archived).length;

  const nav = [
    {
      key: "new",
      icon: <PlusIcon className="size-3.5" />,
      label: "新建任务",
      hint: "⌘N",
      onClick: () => void createSession(defaultCwd),
    },
    {
      key: "search",
      icon: <SearchIcon className="size-3.5" />,
      label: "搜索",
      hint: "⌘K",
      onClick: () => setSearching((current) => !current),
    },
    {
      key: "tasks",
      icon: <BoltIcon className="size-3.5" />,
      label: "自动化",
      hint: "",
      onClick: onOpenTasks,
    },
    {
      key: "plugins",
      icon: <PackageIcon className="size-3.5" />,
      label: "插件市场",
      hint: "",
      onClick: onOpenMarketplace,
    },
  ];

  return (
    <aside
      className="app-sidebar flex w-60 shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
      data-open={isOpen ? "true" : undefined}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="flex size-5 items-center justify-center rounded-md bg-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-accent-foreground)]">
          {productName.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-xs font-medium">{productName}</span>
        {onClose !== undefined && (
          <IconButton
            className="ml-auto"
            icon={<ChevronRightIcon />}
            label="收起侧栏"
            onClick={onClose}
          />
        )}
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pb-2">
        {nav.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-content)]"
          >
            <span className="text-[var(--color-content-faint)]">{item.icon}</span>
            <span className="truncate">{item.label}</span>
            {item.hint !== "" && (
              <span className="ml-auto">
                <Kbd>{item.hint}</Kbd>
              </span>
            )}
          </button>
        ))}
      </nav>

      {searching && (
        <div className="border-y border-[var(--color-border-subtle)] px-2 py-1.5">
          <input
            ref={search}
            value={query}
            placeholder="搜索会话（Esc 关闭）"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setSearching(false);
              setQuery("");
            }}
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs outline-none placeholder:text-[var(--color-content-faint)] focus:border-[var(--color-border-active)]"
          />
        </div>
      )}

      <div className="flex h-8 shrink-0 items-center gap-1 px-3 text-[11px] text-[var(--color-content-faint)]">
        <span>项目</span>
        {!showArchived && archivedCount > 0 && <span>· 已隐藏 {archivedCount}</span>}
        <span className="ml-auto">
          <IconButton
            className="size-6"
            icon={<ArchiveIcon className="size-3.5" />}
            label={showArchived ? "隐藏已归档会话" : "显示已归档会话"}
            active={showArchived}
            onClick={() => setShowArchived((current) => !current)}
          />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-[var(--color-content-faint)]">
            {query === "" ? "还没有会话。" : "没有匹配的会话。"}
          </p>
        )}
        {groups.map((group) => {
          const isCollapsed = collapsed.includes(group.key);
          const toggle = (): void =>
            setCollapsed((current) =>
              current.includes(group.key)
                ? current.filter((key) => key !== group.key)
                : [...current, group.key],
            );
          return (
            <section key={group.key} className="mt-1">
              <button
                type="button"
                onClick={toggle}
                title={group.key}
                className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-raised)]"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
                <span className="truncate font-medium">{group.label}</span>
                <span className="ml-auto shrink-0 text-[var(--color-content-faint)]">
                  {group.sessions.length}
                </span>
              </button>
              {!isCollapsed &&
                group.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === state.activeSessionId}
                    timeLabel={formatRelativeTime(session.updatedAt, now)}
                    running={state.views[session.id]?.running === true}
                    waiting={state.views[session.id]?.state?.status === "waiting"}
                    readOnly={state.views[session.id]?.readOnly === true}
                    onOpen={() => void attachSession(session.id)}
                    onFork={() => void forkSession(session.id)}
                    onArchive={() => void archiveSession(session.id, !session.archived)}
                  />
                ))}
            </section>
          );
        })}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-[var(--color-border-subtle)] px-3 text-[11px] text-[var(--color-content-faint)]">
        <ShieldIcon className="size-3.5" />
        <span className="truncate">{state.coreId?.slice(0, 12) ?? "未连接"}</span>
        {state.trustLevel !== null && <Badge tone="muted">{state.trustLevel}</Badge>}
        <span className="ml-auto text-[var(--color-content-muted)]">
          <IconButton
            className="size-6"
            icon={<SlidersIcon />}
            label="模型与供应商配置"
            onClick={onOpenModelConfig}
          />
        </span>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  active,
  timeLabel,
  running,
  waiting,
  readOnly,
  onOpen,
  onFork,
  onArchive,
}: {
  session: SessionSummary;
  active: boolean;
  timeLabel: string;
  running: boolean;
  waiting: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onFork: () => void;
  onArchive: () => void;
}): ReactNode {
  const tone = sessionTone({ isActive: active, running, waiting, readOnly });
  return (
    <div
      className={`group mb-0.5 rounded-md px-1.5 py-1 transition-colors ${
        active ? "bg-[var(--color-surface-overlay)]" : "hover:bg-[var(--color-surface-raised)]"
      }`}
    >
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 text-left">
        <span className={`size-1.5 shrink-0 rounded-full ${TONE_CLASSES[tone]}`} />
        <span
          className={`min-w-0 flex-1 truncate text-xs ${
            active ? "text-[var(--color-content)]" : "text-[var(--color-content-muted)]"
          }`}
        >
          {sessionTitle(session)}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-content-faint)]">{timeLabel}</span>
      </button>
      {/* 操作与副标题只在当前会话上占位：每一行都留两行高，八条会话就要滚屏了。 */}
      {active && (
        <div className="mt-0.5 flex items-center gap-0.5 pl-3.5">
          <IconButton
            className="size-5"
            icon={<ForkIcon className="size-3" />}
            label="从这条会话分叉"
            onClick={onFork}
          />
          <IconButton
            className="size-5"
            icon={<ArchiveIcon className="size-3" />}
            label={session.archived ? "取消归档" : "归档"}
            onClick={onArchive}
          />
          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-content-faint)]">
            {sessionSubtitle(session)}
          </span>
        </div>
      )}
    </div>
  );
}
