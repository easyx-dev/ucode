import type { AutonomyLevel } from "@ucode/sdk";
import { toDisplayItems } from "@ucode/sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
                        {session.owned && <Badge tone="accent">owner</Badge>}
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

export function TopBar({ onToggleTerminal }: { onToggleTerminal: () => void }): ReactNode {
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

      <div className="ml-auto flex items-center gap-2 text-xs">
        <select
          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1.5 py-1 text-xs"
          value={
            view?.state?.model === null || view?.state?.model === undefined
              ? ""
              : `${view.state.model.provider}/${view.state.model.modelId}`
          }
          onChange={(event) => {
            const [provider, modelId] = event.target.value.split("/");
            if (sessionId !== null && provider !== undefined && modelId !== undefined) {
              void setModel(sessionId, provider, modelId);
            }
          }}
          title="切换模型"
        >
          <option value="">（默认模型）</option>
          {state.models.map((model) => (
            <option
              key={`${model.provider}/${model.modelId}`}
              value={`${model.provider}/${model.modelId}`}
            >
              {model.provider}/{model.modelId}
            </option>
          ))}
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

function UserRow({ text }: { text: string }): ReactNode {
  return (
    <div className="my-3 flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] px-3 py-2">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-5">{text}</p>
      </div>
    </div>
  );
}

function AssistantRow({
  markdown,
  streaming,
}: {
  markdown: string;
  streaming?: boolean;
}): ReactNode {
  return (
    <div className="my-3">
      <div className="mb-1 text-[11px] font-medium text-[var(--color-content-muted)]">助手</div>
      <Markdown>{markdown}</Markdown>
      {streaming === true && (
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--color-accent)] align-middle" />
      )}
    </div>
  );
}

function NoticeRow({ text }: { text: string }): ReactNode {
  return <p className="my-2 text-center text-[11px] text-[var(--color-content-muted)]">{text}</p>;
}

export function Transcript({ sessionId }: { sessionId: string }): ReactNode {
  const state = useAgentStore((store) => store.state);
  const view = state.views[sessionId];
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
              return <UserRow key={item.id} text={item.text} />;
            case "assistant":
              return (
                <AssistantRow
                  key={item.id}
                  markdown={item.markdown}
                  streaming={item.id === "__streaming__"}
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

export function Composer({ sessionId }: { sessionId: string }): ReactNode {
  const draft = useAgentStore((store) => store.drafts[sessionId] ?? "");
  const setDraft = useAgentStore((store) => store.setDraft);
  const send = useAgentStore((store) => store.send);
  const state = useAgentStore((store) => store.state);
  const view = state.views[sessionId];
  const running = view?.running === true;
  const readOnly = view?.readOnly === true;
  const pending = state.interactions.filter((request) => request.sessionId === sessionId).length;
  const usage = view?.usage as { totalTokens?: number } | undefined;
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  const autoGrow = (): void => {
    const node = textarea.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  };
  useEffect(autoGrow, [draft]);

  const blocked = readOnly || pending > 0;

  return (
    <div className="border-t border-[var(--color-border-subtle)] p-3">
      {readOnly && (
        <p className="mb-2 rounded bg-[oklch(0.34_0.06_80)] px-2 py-1 text-[11px] text-[var(--color-warn)]">
          该会话是只读挂载：写权限在另一个核心层实例手上（同一会话只允许一个 writer）。
        </p>
      )}
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] focus-within:border-[var(--color-accent)]">
        <textarea
          ref={textarea}
          value={draft}
          disabled={blocked}
          rows={2}
          placeholder={
            pending > 0
              ? "先处理上面的请求…"
              : running
                ? "运行中：Enter 作为 steer 送入本轮"
                : "输入消息，Enter 发送，Shift+Enter 换行"
          }
          className="block w-full resize-none bg-transparent px-3 pt-2.5 font-[var(--font-mono)] text-[13px] leading-5 outline-none"
          onChange={(event) => {
            setDraft(sessionId, event.target.value);
            autoGrow();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(sessionId);
            }
          }}
        />
        <div className="flex items-center gap-2 px-2.5 pb-2 pt-1 text-[11px] text-[var(--color-content-muted)]">
          <span>自主级别：{view?.state?.autonomy ?? "confirm"}</span>
          {usage?.totalTokens !== undefined && <span>tokens：{usage.totalTokens}</span>}
          {(view?.state?.pendingMessages ?? 0) > 0 && (
            <span>队列 {view?.state?.pendingMessages}</span>
          )}
          <Button
            className="ml-auto"
            size="sm"
            variant={running ? "danger" : "primary"}
            disabled={draft.trim() === "" || blocked}
            onClick={() => void send(sessionId)}
          >
            {running ? "送入本轮" : "发送"}
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

export function EmptyState({ onCreate }: { onCreate: () => void }): ReactNode {
  return (
    <Card className="m-6 p-6 text-sm">
      <p className="mb-3">还没有打开任何会话。</p>
      <Button variant="primary" onClick={onCreate}>
        新建会话
      </Button>
    </Card>
  );
}
