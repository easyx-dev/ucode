import type { AutonomyLevel } from "@ucode/sdk";
import { toDisplayMessages } from "@ucode/sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Modal, Spinner } from "./components/primitives.tsx";
import { useAgentStore } from "./context.ts";

/** 顶栏：连的是哪个核心层、当前会话的模型与自主级别、以及中止/压缩两个动作。 */
export function TopBar(): ReactNode {
  const state = useAgentStore((store) => store.state);
  const setModel = useAgentStore((store) => store.setModel);
  const setAutonomy = useAgentStore((store) => store.setAutonomy);
  const abort = useAgentStore((store) => store.abort);
  const compact = useAgentStore((store) => store.compact);
  const sessionId = state.activeSessionId;
  const view = sessionId === null ? undefined : state.views[sessionId];
  const running = view?.running === true;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] px-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full bg-[var(--color-accent)]" />
        {view?.summary?.name ?? view?.state?.name ?? "会话"}
      </div>

      {!state.connected && <Badge tone="warn">未连接，正在重连…</Badge>}
      {state.rejection !== null && <Badge tone="danger">{state.rejection.message}</Badge>}

      <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-content-muted)]">
        {running && (
          <span className="flex items-center gap-1">
            <Spinner /> 运行中
          </span>
        )}
        {view?.state?.status === "waiting" && <Badge tone="warn">等待应答</Badge>}

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
        >
          <option value="confirm">变更前确认</option>
          <option value="plan">计划模式</option>
          <option value="auto-edit">自动编辑</option>
          <option value="full-access">完全访问</option>
        </select>

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

/** 侧栏：会话列表（新建、切换、分叉）。 */
export function SessionSidebar({ productName }: { productName: string }): ReactNode {
  const state = useAgentStore((store) => store.state);
  const createSession = useAgentStore((store) => store.createSession);
  const attachSession = useAgentStore((store) => store.attachSession);
  const forkSession = useAgentStore((store) => store.forkSession);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-border-subtle)]">
      <div className="flex h-12 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        <span className="text-sm font-semibold">{productName}</span>
        <Button size="sm" className="ml-auto" onClick={() => void createSession()}>
          ＋ 新会话
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {state.sessions.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--color-content-muted)]">还没有会话。</p>
        )}
        {state.sessions.map((session) => {
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
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--color-content-muted)]">
                    {session.entryCount}
                  </span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-[var(--color-content-muted)]">
                  {session.firstMessage ?? "（空会话）"}
                </span>
              </button>
              {active && (
                <div className="px-2 pb-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void forkSession(session.id)}
                    className="rounded px-1 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]"
                  >
                    分叉
                  </button>
                </div>
              )}
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

/** 转录：权威记录 + 非权威的流式尾巴（后者明确标注，避免"看起来一样但没保存"）。 */
export function Transcript({ sessionId }: { sessionId: string }): ReactNode {
  const state = useAgentStore((store) => store.state);
  const view = state.views[sessionId];
  // 注意：选择器**不能**返回每次新建的数组（React 会认为快照一直在变而无限重渲）。
  // 派生数据在组件里用 useMemo 算。
  const messages = useMemo(() => (view === undefined ? [] : toDisplayMessages(view)), [view]);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [messages.length, view?.streaming.text, view?.streaming.thinking]);

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">
          还没有消息。写下第一句，Enter 发送（Shift+Enter 换行）。
        </p>
      )}
      {messages.map((message) => (
        <div key={`${message.id}:${message.seq}`} className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--color-content-muted)]">
            <span
              className={
                message.role === "user"
                  ? "text-[var(--color-accent)]"
                  : message.role === "tool"
                    ? "text-[oklch(0.75_0.1_310)]"
                    : message.role === "notice"
                      ? "text-[var(--color-warn)]"
                      : ""
              }
            >
              {message.role === "user"
                ? "你"
                : message.role === "tool"
                  ? "工具"
                  : message.role === "notice"
                    ? "提示"
                    : "助手"}
            </span>
            {message.streaming === true && <Badge tone="muted">流式 · 尚未落盘</Badge>}
          </div>
          <pre className="whitespace-pre-wrap break-words font-[var(--font-mono)] text-[13px] leading-5">
            {message.text}
          </pre>
        </div>
      ))}
      {view !== undefined && view.streaming.thinking !== "" && (
        <div className="mb-3 text-[12px] text-[var(--color-content-muted)]">
          <div className="mb-1 text-[11px]">思考中…</div>
          <pre className="whitespace-pre-wrap break-words font-[var(--font-mono)]">
            {view.streaming.thinking.slice(-2_000)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** 输入区：运行中提交会作为 steer 送入当前这一轮（不打断）。 */
export function Composer({ sessionId }: { sessionId: string }): ReactNode {
  const draft = useAgentStore((store) => store.drafts[sessionId] ?? "");
  const setDraft = useAgentStore((store) => store.setDraft);
  const send = useAgentStore((store) => store.send);
  const state = useAgentStore((store) => store.state);
  const running = state.views[sessionId]?.running === true;
  const pending = state.interactions.filter((request) => request.sessionId === sessionId).length;

  return (
    <div className="border-t border-[var(--color-border-subtle)] p-3">
      <textarea
        className="h-20 w-full resize-none rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-2 font-[var(--font-mono)] text-[13px] outline-none focus:border-[var(--color-accent)]"
        placeholder={
          pending > 0
            ? "先处理上面的请求…"
            : running
              ? "运行中：Enter 作为 steer 送入"
              : "输入消息，Enter 发送"
        }
        value={draft}
        disabled={pending > 0}
        onChange={(event) => setDraft(sessionId, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send(sessionId);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-content-muted)]">
        <Button
          variant="primary"
          size="sm"
          disabled={draft.trim() === "" || pending > 0}
          onClick={() => void send(sessionId)}
        >
          {running ? "送入本轮" : "发送"}
        </Button>
        <span>当前自主级别：{state.views[sessionId]?.state?.autonomy ?? "confirm"}</span>
        <span className="ml-auto">
          {state.views[sessionId]?.state?.pendingMessages !== undefined &&
          (state.views[sessionId]?.state?.pendingMessages ?? 0) > 0
            ? `队列中 ${state.views[sessionId]?.state?.pendingMessages} 条`
            : ""}
        </span>
      </div>
    </div>
  );
}

/** 挂载即聚焦（等价于 autoFocus，但不触发 a11y 规则；弹窗里键盘必须立刻可用）。 */
function focusOnMount(node: HTMLTextAreaElement | null): void {
  node?.focus();
}

/** 交互弹窗：核心层发起的阻塞式请求（权限确认等）。丢一次会让 agent 永久挂起，所以必须显式应答。 */
export function InteractionDialog(): ReactNode {
  const state = useAgentStore((store) => store.state);
  const respond = useAgentStore((store) => store.respond);
  const sessionId = state.activeSessionId;
  const interaction =
    state.interactions.find((request) => request.sessionId === sessionId) ?? state.interactions[0];
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);

  const options = useMemo(() => {
    const params = interaction?.params as { options?: string[] } | undefined;
    return params?.options ?? [];
  }, [interaction]);

  useEffect(() => {
    setText("");
    setSelected(0);
  }, [interaction?.id]);

  if (interaction === undefined) return null;
  const params = interaction.params as {
    title?: string;
    message?: string;
    placeholder?: string;
    prefill?: string;
  };

  return (
    <Modal title={params.title ?? "需要你的决定"}>
      {params.message !== undefined && (
        <p className="mb-3 whitespace-pre-wrap text-sm">{params.message}</p>
      )}

      {interaction.method === "select" && (
        <div className="flex flex-col gap-1">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelected(index)}
              className={`rounded px-2 py-1 text-left text-sm ${
                index === selected
                  ? "bg-[var(--color-accent-soft)]"
                  : "hover:bg-[var(--color-surface-raised)]"
              }`}
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

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          onClick={() => respond(interaction.id, null, true)}
          title="取消（核心层会按超时/降级策略处置）"
        >
          取消
        </Button>
        {interaction.method === "confirm" ? (
          <>
            <Button variant="danger" onClick={() => respond(interaction.id, false)}>
              拒绝
            </Button>
            <Button variant="primary" onClick={() => respond(interaction.id, true)}>
              允许
            </Button>
          </>
        ) : interaction.method === "select" ? (
          <Button
            variant="primary"
            onClick={() => respond(interaction.id, options[selected] ?? null)}
          >
            确认
          </Button>
        ) : (
          <Button variant="primary" onClick={() => respond(interaction.id, text)}>
            提交
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** 底部状态条：忙闲、待决交互、用量、最近通知。 */
export function StatusBar(): ReactNode {
  const state = useAgentStore((store) => store.state);
  const sessionId = state.activeSessionId;
  const view = sessionId === null ? undefined : state.views[sessionId];
  const usage = view?.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;
  const notices = state.notices.slice(-2);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--color-border-subtle)] px-3 text-[11px] text-[var(--color-content-muted)]">
      <span>{state.connected ? "已连接" : "未连接"}</span>
      <span>状态：{view?.state?.status ?? "idle"}</span>
      <span>会话：{sessionId?.slice(0, 12) ?? "—"}</span>
      <span>游标：{view?.maxSeq ?? 0}</span>
      {usage?.totalTokens !== undefined && <span>tokens：{usage.totalTokens}</span>}
      {usage?.cost?.total !== undefined && <span>成本：{usage.cost.total.toFixed(4)}</span>}
      {view?.needsResync && <Badge tone="warn">需要全量重新同步</Badge>}
      {notices.map((notice) => (
        <span
          key={`${notice.at}-${notice.message}`}
          className={notice.level === "error" ? "text-[var(--color-danger)]" : ""}
        >
          {notice.message}
        </span>
      ))}
    </footer>
  );
}

/** 空态：没有任何会话时引导用户建一个。 */
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
