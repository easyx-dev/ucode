import type { AutonomyLevel } from "@ucode/sdk";
import { toDisplayItems } from "@ucode/sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  commandUsage,
  matchCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
  usageOf,
} from "./components/command-hints.ts";
import { CommandHints } from "./components/command-hints-panel.tsx";
import { Markdown } from "./components/markdown.tsx";
import { Badge, Button, Card, Modal, Spinner } from "./components/primitives.tsx";
import { ThinkingBlock, ToolCard } from "./components/tool-card.tsx";
import { useAgentStore } from "./context.ts";

/**
 * 壳子的全部视图（ZCode 为蓝本，spec §9：只借鉴交互与视觉，不搬代码）。
 *
 * 布局：左侧会话栏（搜索 + 按时间分组 + 归档）· 主列（顶栏 / 转录 / 输入区 / 状态条）。
 * 转录按**结构化展示项**渲染：用户气泡、助手 Markdown、可折叠的工具卡片、思考块。
 */

// ── 会话侧栏 ──

function groupOf(updatedAt: string): "today" | "week" | "earlier" {
  const time = Date.parse(updatedAt);
  const now = Date.now();
  if (Number.isNaN(time)) return "earlier";
  if (now - time < 24 * 3600_000) return "today";
  if (now - time < 7 * 24 * 3600_000) return "week";
  return "earlier";
}

const GROUP_LABELS: Record<string, string> = { today: "今天", week: "本周", earlier: "更早" };

export function SessionSidebar({ productName }: { productName: string }): ReactNode {
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const attachSession = useAgentStore((store) => store.attachSession);
  const forkSession = useAgentStore((store) => store.forkSession);
  const archiveSession = useAgentStore((store) => store.archiveSession);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const visible = state.sessions.filter((session) => {
    if (!showArchived && session.archived) return false;
    if (query.trim() === "") return true;
    const haystack = `${session.name ?? ""} ${session.firstMessage ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const groups = new Map<string, typeof visible>();
  for (const session of visible) {
    const group = groupOf(session.updatedAt);
    const list = groups.get(group) ?? [];
    list.push(session);
    groups.set(group, list);
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border-subtle)]">
      <div className="flex h-12 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        <span className="text-sm font-semibold">{productName}</span>
        <Button size="sm" className="ml-auto" onClick={() => void createSession()}>
          ＋ 新会话
        </Button>
      </div>
      <div className="border-b border-[var(--color-border-subtle)] p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话…"
          className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <label className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--color-content-muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="size-3"
          />
          显示已归档
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--color-content-muted)]">
            {query === "" ? "还没有会话。" : "没有匹配的会话。"}
          </p>
        )}
        {(["today", "week", "earlier"] as const).map((group) => {
          const sessions = groups.get(group) ?? [];
          if (sessions.length === 0) return null;
          return (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-medium text-[var(--color-content-muted)]">
                {GROUP_LABELS[group]}
              </div>
              {sessions.map((session) => {
                const active = session.id === state.activeSessionId;
                return (
                  <div
                    key={session.id}
                    className={`mb-1 rounded-md transition-colors ${
                      active
                        ? "bg-[var(--color-surface-overlay)] text-[var(--color-content)]"
                        : "text-[var(--color-content-muted)] hover:bg-[var(--color-surface-raised)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void attachSession(session.id)}
                      className="w-full px-2 pt-2 text-left text-xs"
                    >
                      <span className="flex items-center gap-1">
                        <span className="truncate font-medium">
                          {session.name ?? session.id.slice(0, 10)}
                        </span>
                        {session.archived && <Badge>已归档</Badge>}
                        <span className="ml-auto shrink-0 text-[10px]">{session.entryCount}</span>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--color-content-muted)]">
                        {session.firstMessage ?? "（空会话）"}
                      </span>
                    </button>
                    {active && (
                      <div className="flex gap-1 px-2 pb-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void forkSession(session.id)}
                          className="rounded px-1 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]"
                        >
                          分叉
                        </button>
                        <button
                          type="button"
                          onClick={() => void archiveSession(session.id, !session.archived)}
                          className="rounded px-1 text-[10px] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-raised)]"
                        >
                          {session.archived ? "取消归档" : "归档"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-[10px] text-[var(--color-content-muted)]">
        core {state.coreId?.slice(0, 18) ?? "—"} · 信任 {state.trustLevel ?? "—"}
      </div>
    </aside>
  );
}

// ── 顶栏 ──

export function TopBar({
  onToggleTerminal,
  onToggleTasks,
  onToggleWorkspace,
  onToggleMarketplace,
  onToggleInsights,
  onOpenModelConfig,
  activeTasks = 0,
}: {
  onToggleTerminal: () => void;
  onToggleTasks?: () => void;
  onToggleWorkspace?: () => void;
  onToggleMarketplace?: () => void;
  onToggleInsights?: () => void;
  onOpenModelConfig?: () => void;
  activeTasks?: number;
}): ReactNode {
  const state = useAgentStore((store) => store.state);
  const setModel = useAgentStore((store) => store.setModel);
  const setAutonomy = useAgentStore((store) => store.setAutonomy);
  const compact = useAgentStore((store) => store.compact);
  const abort = useAgentStore((store) => store.abort);
  const sessionId = state.activeSessionId;
  const view = sessionId === null ? undefined : state.views[sessionId];
  const running = view?.running === true;
  const title =
    view?.summary?.name ??
    view?.state?.name ??
    (sessionId === null ? "会话" : sessionId.slice(0, 12));

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
      <h1 className="truncate text-sm font-medium">{title}</h1>
      {!state.connected && <Badge tone="warn">未连接，正在重连…</Badge>}
      {view?.readOnly === true && <Badge tone="warn">只读挂载</Badge>}
      {view?.state?.status === "waiting" && <Badge tone="warn">等待应答</Badge>}
      {running && (
        <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
          <Spinner />
          运行中
        </span>
      )}

      <div className="topbar-actions ml-auto flex items-center gap-2 text-xs">
        {onToggleWorkspace !== undefined && (
          <Button size="sm" onClick={onToggleWorkspace} title="工作区：文件树 / 变更 / 历史 / 预览">
            工作区
          </Button>
        )}
        {onToggleMarketplace !== undefined && (
          <Button size="sm" onClick={onToggleMarketplace} title="插件与市场：源 / 目录 / 已装">
            插件
          </Button>
        )}
        {onToggleInsights !== undefined && (
          <Button size="sm" onClick={onToggleInsights} title="用量 / 支持包 / 迁移">
            用量
          </Button>
        )}
        {onToggleTasks !== undefined && (
          <Button size="sm" onClick={onToggleTasks} title="自动化任务面板">
            自动化{activeTasks > 0 ? ` (${activeTasks})` : ""}
          </Button>
        )}
        <select
          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1.5 py-1 text-xs"
          value={
            view?.state?.model === null || view?.state?.model === undefined
              ? ""
              : `${view.state.model.provider}/${view.state.model.modelId}`
          }
          onChange={(event) => {
            if (event.target.value === "__manage__") {
              onOpenModelConfig?.();
              return;
            }
            const [provider, modelId] = event.target.value.split("/");
            if (sessionId !== null && provider !== undefined && modelId !== undefined) {
              void setModel(sessionId, provider, modelId);
            }
          }}
          title="选择模型"
        >
          <option value="">
            {state.models.length === 0 ? "（还没有可用模型）" : "（默认模型）"}
          </option>
          {state.models.map((model) => (
            <option
              key={`${model.provider}/${model.modelId}`}
              value={`${model.provider}/${model.modelId}`}
            >
              {model.provider}/{model.modelId}
            </option>
          ))}
          {/* 对齐 zcode 的「管理模型」：选择器里直接带一个入口，不用去别处找。 */}
          {onOpenModelConfig !== undefined && <option value="__manage__">管理模型…</option>}
        </select>
        <select
          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1.5 py-1 text-xs"
          value={(view?.state?.autonomy ?? "confirm") as string}
          onChange={(event) => {
            if (sessionId !== null)
              void setAutonomy(sessionId, event.target.value as AutonomyLevel);
          }}
          title="执行模式"
        >
          <option value="confirm">变更前确认</option>
          <option value="plan">计划模式</option>
          <option value="auto-edit">自动编辑</option>
          <option value="full-access">完全访问</option>
        </select>
        <Button size="sm" onClick={onToggleTerminal} title="打开/关闭终端面板（工作区 PTY）">
          终端
        </Button>
        <Button
          size="sm"
          onClick={() => sessionId !== null && void compact(sessionId)}
          title="手动压缩上下文"
        >
          压缩
        </Button>
        <Button
          size="sm"
          variant={running ? "danger" : "ghost"}
          disabled={!running}
          onClick={() => sessionId !== null && void abort(sessionId)}
        >
          中止
        </Button>
      </div>
    </header>
  );
}

// ── 转录 ──

function UserRow({ text, onQuote }: { text: string; onQuote?: () => void }): ReactNode {
  return (
    <div className="group my-3 flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] px-3 py-2">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-5">{text}</p>
        {onQuote !== undefined && (
          <div className="reveal-hover mt-1 flex justify-end">
            <Button size="sm" onClick={onQuote} title="把这段引用到输入框追问">
              追问这段
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantRow({
  markdown,
  streaming,
  onQuote,
}: {
  markdown: string;
  streaming?: boolean;
  onQuote?: () => void;
}): ReactNode {
  return (
    <div className="group my-3">
      <div className="mb-1 text-[11px] font-medium text-[var(--color-content-muted)]">助手</div>
      <Markdown>{markdown}</Markdown>
      {streaming === true && (
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--color-accent)] align-middle" />
      )}
      {onQuote !== undefined && (
        <div className="reveal-hover mt-1">
          <Button size="sm" onClick={onQuote} title="把这段引用到输入框追问">
            追问这段
          </Button>
        </div>
      )}
    </div>
  );
}

function NoticeRow({ text }: { text: string }): ReactNode {
  return <p className="my-2 text-center text-[11px] text-[var(--color-content-muted)]">{text}</p>;
}

/** 持久化待决交互卡片（无人值守场景）：当时无人应答，现在可以补答。 */
function PendingRow({
  item,
  onResolve,
}: {
  item: { interactionId: string; method: string; params: Record<string, unknown> };
  onResolve: (value: string | boolean | null) => void;
}): ReactNode {
  const [resolved, setResolved] = useState<string | null>(null);
  const params = item.params as
    | { title?: string; message?: string; options?: string[] }
    | undefined;

  if (resolved !== null) {
    return <NoticeRow text={`待决交互已处理（${resolved}）`} />;
  }
  return (
    <div className="my-2 rounded-md border border-[var(--color-warn)] bg-[oklch(0.3_0.05_80)] p-3">
      <p className="text-[12px] font-medium text-[var(--color-warn)]">
        ⏸ 待决交互（当时无人应答，已持久化）
      </p>
      {params?.title !== undefined && <p className="mt-1 text-[13px]">{params.title}</p>}
      {params?.message !== undefined && (
        <p className="text-[12px] text-[var(--color-content-muted)]">{params.message}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {params?.options !== undefined ? (
          params.options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === "拒绝" ? "danger" : "ghost"}
              onClick={() => {
                setResolved(option);
                onResolve(option);
              }}
            >
              {option}
            </Button>
          ))
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setResolved("允许");
                onResolve(true);
              }}
            >
              允许
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setResolved("拒绝");
                onResolve(false);
              }}
            >
              拒绝
            </Button>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--color-content-muted)]">
        应答后会作为新的消息转达给 agent（agent 据此重试或调整方案）。
      </p>
    </div>
  );
}

export function Transcript({ sessionId }: { sessionId: string }): ReactNode {
  const state = useAgentStore((store) => store.state);
  const view = state.views[sessionId];
  const resolveInteraction = useAgentStore((store) => store.resolveInteraction);
  const quoteIntoDraft = useAgentStore((store) => store.quoteIntoDraft);
  const items = useMemo(() => (view === undefined ? [] : toDisplayItems(view)), [view]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const lastItem = items.at(-1);

  useEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [items.length, lastItem]);

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3">
      {items.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">
          还没有消息。写下第一句，Enter 发送（Shift+Enter 换行）。
        </p>
      )}
      {items.map((item) => {
        const row = (() => {
          switch (item.kind) {
            case "user":
              return (
                <UserRow
                  key={item.id}
                  text={item.text}
                  onQuote={() => quoteIntoDraft(sessionId, item.text)}
                />
              );
            case "assistant":
              return (
                <AssistantRow
                  key={item.id}
                  markdown={item.markdown}
                  streaming={item.id === "__streaming__"}
                  onQuote={() => quoteIntoDraft(sessionId, item.markdown)}
                />
              );
            case "tool":
              return <ToolCard key={item.id} item={item} />;
            case "thinking":
              return <ThinkingBlock key={item.id} text={item.text} />;
            case "notice":
              return <NoticeRow key={item.id} text={item.text} />;
            case "compaction":
              return (
                <NoticeRow key={item.id} text={`[上下文已压缩] ${item.summary.slice(0, 200)}`} />
              );
          }
        })();
        return row;
      })}
    </div>
  );
}

// ── 输入区 ──

export type ComposerPanel = "tasks" | "plugins" | "usage" | "model";

export function Composer({
  sessionId,
  onOpenPanel,
  productName,
}: {
  sessionId: string;
  onOpenPanel: (panel: ComposerPanel) => void;
  productName: string;
}): ReactNode {
  const draft = useAgentStore((store) => store.drafts[sessionId] ?? "");
  const setDraft = useAgentStore((store) => store.setDraft);
  const send = useAgentStore((store) => store.send);
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const compact = useAgentStore((store) => store.compact);
  const setAutonomy = useAgentStore((store) => store.setAutonomy);
  const abort = useAgentStore((store) => store.abort);
  const view = state.views[sessionId];
  const running = view?.running === true;
  const readOnly = view?.readOnly === true;
  const modelAvailable = view?.state?.modelAvailable !== false;
  const pending = state.interactions.filter((request) => request.sessionId === sessionId).length;
  const usage = view?.usage as { totalTokens?: number } | undefined;
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [hintsDismissed, setHintsDismissed] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const hints = hintsDismissed ? [] : matchCommands(draft);
  const hasHistory = (view?.entries.length ?? 0) > 0;

  const runCommand = async (name: string, args: string[]): Promise<void> => {
    switch (name) {
      case "/help":
        setLocalNotice(
          SLASH_COMMANDS.map((command) => `${usageOf(command)} — ${command.description}`).join(
            "\n",
          ),
        );
        return;
      case "/new":
        await createSession(args[0]);
        return;
      case "/compact":
        await compact(sessionId);
        return;
      case "/model":
        onOpenPanel("model");
        return;
      case "/tasks":
        onOpenPanel("tasks");
        return;
      case "/plugins":
        onOpenPanel("plugins");
        return;
      case "/usage":
        onOpenPanel("usage");
        return;
      case "/autonomy": {
        const level = args[0];
        if (level === undefined) {
          setLocalNotice(`用法：${commandUsage("/autonomy") ?? ""}`);
          return;
        }
        await setAutonomy(sessionId, level as AutonomyLevel);
        return;
      }
      default: {
        const usageText = commandUsage(name);
        setLocalNotice(
          usageText === null ? `未知命令 ${name}。输入 / 查看可用命令。` : `用法：${usageText}`,
        );
      }
    }
  };

  const submit = (): void => {
    const command = parseSlashCommand(draft);
    if (command !== null) {
      // 命令由壳自己执行，不进对话——否则模型会收到一条它看不懂的 `/compact`。
      setDraft(sessionId, "");
      setLocalNotice(null);
      void runCommand(command.name, command.args);
      return;
    }
    void send(sessionId);
  };

  const completeCommand = (selected: number): void => {
    const target = hints[selected];
    if (target === undefined) return;
    setDraft(sessionId, `${target.name}${target.args === undefined ? " " : " "}`);
    setHintsDismissed(false);
    textarea.current?.focus();
  };

  const autoGrow = (): void => {
    const node = textarea.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  };
  useEffect(autoGrow, [draft]);

  const blocked = readOnly || pending > 0;
  // zcode 的 placeholder 按上下文换（新任务 / 追问 / 排队），不是一句固定的提示。
  const placeholder =
    pending > 0
      ? "先处理上面的请求…"
      : !modelAvailable
        ? "还没有可用模型：点「模型」配置一个供应商"
        : running
          ? "继续输入以排队后续修改"
          : hasHistory
            ? "提出后续修改要求"
            : `向 ${productName} 提问，使用 / 选择命令或能力`;

  return (
    <div className="border-t border-[var(--color-border-subtle)] p-3">
      {readOnly && (
        <p className="mb-2 rounded bg-[oklch(0.34_0.06_80)] px-2 py-1 text-[11px] text-[var(--color-warn)]">
          该会话当前只读：本机没有它的写权限。
        </p>
      )}
      {!modelAvailable && !readOnly && (
        <p className="mb-2 flex items-center gap-2 rounded bg-[oklch(0.34_0.06_80)] px-2 py-1 text-[11px] text-[var(--color-warn)]">
          还没有可用的模型，发送会被拒绝。
          <button
            type="button"
            className="underline"
            onClick={() => onOpenPanel("model")}
            title="配置供应商：端点 / 密钥 / 模型 ID"
          >
            立即配置
          </button>
        </p>
      )}
      {localNotice !== null && (
        <div className="mb-2 flex items-start gap-2 rounded bg-[var(--color-surface-overlay)] px-2 py-1.5">
          <pre className="flex-1 whitespace-pre-wrap break-words font-[var(--font-mono)] text-[11px] text-[var(--color-content)]">
            {localNotice}
          </pre>
          <button
            type="button"
            className="text-[10px] text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
            onClick={() => setLocalNotice(null)}
          >
            关闭
          </button>
        </div>
      )}
      <CommandHints
        input={draft}
        selected={hintIndex}
        onHover={setHintIndex}
        onDismiss={() => setHintsDismissed(true)}
        onSelect={(command) => {
          const index = hints.findIndex((candidate) => candidate.name === command.name);
          completeCommand(index < 0 ? 0 : index);
        }}
      />
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] focus-within:border-[var(--color-accent)]">
        <textarea
          ref={textarea}
          value={draft}
          disabled={blocked}
          rows={2}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 font-[var(--font-mono)] text-[13px] leading-5 outline-none"
          onChange={(event) => {
            setDraft(sessionId, event.target.value);
            setHintIndex(0);
            setHintsDismissed(false);
            setLocalNotice(null);
            autoGrow();
          }}
          onKeyDown={(event) => {
            if (hints.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHintIndex((current) => (current + 1) % hints.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHintIndex((current) => (current - 1 + hints.length) % hints.length);
                return;
              }
              // Enter / Tab 先把命令名补全，再把光标交回输入框让用户填参数。
              if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                event.preventDefault();
                completeCommand(hintIndex);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setHintsDismissed(true);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center gap-2 px-2.5 pb-2 pt-1 text-[11px] text-[var(--color-content-muted)]">
          <span>自主级别：{view?.state?.autonomy ?? "confirm"}</span>
          {usage?.totalTokens !== undefined && <span>tokens：{usage.totalTokens}</span>}
          {(view?.state?.pendingMessages ?? 0) > 0 && (
            <span>队列 {view?.state?.pendingMessages}</span>
          )}
          <span className="ml-auto">Enter 发送 · Shift+Enter 换行 · / 命令</span>
          {running && draft.trim() === "" && (
            <Button size="sm" title="停止生成（Esc）" onClick={() => void abort(sessionId)}>
              停止
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={draft.trim() === "" || blocked}
            title={running ? "排队：本轮结束后发送" : "发送"}
            onClick={submit}
          >
            {running ? "排队" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 交互弹窗 ──

function focusOnMount(node: HTMLTextAreaElement | null): void {
  node?.focus();
}

export function InteractionDialog(): ReactNode {
  const state = useAgentStore((store) => store.state);
  const respond = useAgentStore((store) => store.respond);
  const sessionId = state.activeSessionId;
  const interaction =
    state.interactions.find((request) => request.sessionId === sessionId) ?? state.interactions[0];
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
  }, [interaction?.id]);

  if (interaction === undefined) return null;
  const params = interaction.params as {
    title?: string;
    message?: string;
    placeholder?: string;
    prefill?: string;
    options?: string[];
  };

  return (
    <Modal title={params.title ?? "需要你的决定"}>
      {params.message !== undefined && params.message !== "" && (
        <p className="mb-3 whitespace-pre-wrap text-sm">{params.message}</p>
      )}

      {interaction.method === "select" && (
        <div className="flex flex-col gap-1">
          {(params.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => respond(interaction.id, option)}
              className="rounded px-2.5 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {(interaction.method === "input" || interaction.method === "editor") && (
        <textarea
          ref={focusOnMount}
          className="h-24 w-full resize-none rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 font-[var(--font-mono)] text-[13px]"
          placeholder={params.placeholder ?? ""}
          defaultValue={interaction.method === "editor" ? (params.prefill ?? "") : ""}
          onChange={(event) => setText(event.target.value)}
        />
      )}

      {interaction.method === "confirm" && (
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={() => respond(interaction.id, false)}>
            拒绝
          </Button>
          <Button variant="primary" onClick={() => respond(interaction.id, true)}>
            允许
          </Button>
        </div>
      )}
      {interaction.method === "select" && (
        <div className="mt-3 flex justify-end">
          <Button onClick={() => respond(interaction.id, null, true)}>取消</Button>
        </div>
      )}
      {(interaction.method === "input" || interaction.method === "editor") && (
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={() => respond(interaction.id, null, true)}>取消</Button>
          <Button variant="primary" onClick={() => respond(interaction.id, text)}>
            提交
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ── 状态条 ──

export function StatusBar(): ReactNode {
  const state = useAgentStore((store) => store.state);
  const sessionId = state.activeSessionId;
  const view = sessionId === null ? undefined : state.views[sessionId];
  const usage = view?.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;
  const lastNotice = state.notices.at(-1);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--color-border-subtle)] px-3 text-[11px] text-[var(--color-content-muted)]">
      <span className={state.connected ? "" : "text-[var(--color-warn)]"}>
        {state.connected ? "已连接" : "未连接，重连中…"}
      </span>
      <span>状态：{view?.state?.status ?? "idle"}</span>
      <span>游标：{view?.maxSeq ?? 0}</span>
      {usage?.totalTokens !== undefined && <span>tokens：{usage.totalTokens}</span>}
      {usage?.cost?.total !== undefined && <span>成本：{usage.cost.total.toFixed(4)}</span>}
      {view !== undefined && view.needsResync && <Badge tone="warn">需要全量重新同步</Badge>}
      {lastNotice !== undefined && (
        <span
          className={`ml-auto truncate ${lastNotice.level === "error" ? "text-[var(--color-danger)]" : ""}`}
        >
          {lastNotice.message}
        </span>
      )}
    </footer>
  );
}

/**
 * 空会话的问候语。
 *
 * 对齐 zcode 的 `ConversationDraftEmptyState`：按时段给一句问候，
 * 而不是一句干巴巴的"还没有消息"——用户打开界面第一眼看到的东西，
 * 决定他知不知道接下来能做什么。
 */
export function greetingFor(hour: number): string {
  if (hour < 5) return "夜深啦，别忘了照顾好自己哦";
  if (hour < 9) return "早上好呀，新的一天开始啦";
  if (hour < 12) return "上午好呀，有什么想让我帮忙的吗";
  if (hour < 14) return "中午好呀，要不要先休息一下";
  if (hour < 18) return "下午好呀，接下来交给我吧";
  return "晚上好呀，今天辛苦啦";
}

export function EmptyState({
  onCreate,
  productName,
}: {
  onCreate: () => void;
  productName: string;
}): ReactNode {
  const hour = new Date().getHours();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <p className="text-lg text-[var(--color-content)]">{greetingFor(hour)}</p>
      <p className="max-w-md text-center text-xs text-[var(--color-content-muted)]">
        向 {productName} 提问，使用 / 选择命令或能力。
      </p>
      <Button variant="primary" onClick={onCreate}>
        新建会话
      </Button>
    </div>
  );
}
