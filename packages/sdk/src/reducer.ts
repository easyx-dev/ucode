import type {
  Capability,
  ErrorInfo,
  Rejected,
  ServerMessage,
  SessionEntry,
  SessionState,
  SessionSummary,
  TrustLevel,
  UiRequest,
} from "@ucode/protocol";

/**
 * 事件折叠（spec §4.5）。
 *
 * 三条不变量决定了这里的形状：
 * 1. **`entry_appended` 是权威、`message_delta` 不是**：增量只用于展示，
 *    权威信号到达后必须用记录本身替换掉累积的增量（否则会出现"看起来一样但没保存"的错觉）。
 * 2. **`turn_end` 不等于完成**：`running` 只在 `agent_settled`（不再有自动工作待办）时才落下。
 * 3. **可重放与续传**：同一条记录可能被送两次（挂载时全量重放 + 续传补齐），
 *    因此按 `seq`/`entryId` 去重是折叠的一部分，而不是调用方的事。
 */

export type DisplayMessage = {
  id: string;
  seq: number;
  role: "user" | "assistant" | "tool" | "notice";
  text: string;
  timestamp: string;
  /** 由非权威增量拼出来的尾部内容（尚未落盘）。 */
  streaming?: boolean;
};

export type SessionView = {
  id: string;
  summary: SessionSummary | null;
  state: SessionState | null;
  entries: SessionEntry[];
  /** entryId → seq：重放/续传会重复投递同一条记录，靠它去重。 */
  seqByEntryId: Record<string, number>;
  maxSeq: number;
  streaming: { text: string; thinking: string };
  running: boolean;
  pendingInteractions: number;
  usage: Record<string, unknown> | null;
  lastError: ErrorInfo | null;
  /** 游标失效（如格式迁移）时为真：控制层必须重新全量同步。 */
  needsResync: boolean;
  /**
   * 只读挂载：本实例不是该会话的 owner（写权限在另一个核心层实例手上，spec §3.5）。
   * 界面必须显式告诉用户，否则"发出去没反应"会被当成 bug。
   */
  readOnly: boolean;
};

export type SdkNotice = { level: "info" | "warn" | "error"; message: string; at: number };

export type SdkState = {
  connected: boolean;
  coreId: string | null;
  trustLevel: TrustLevel | null;
  grantedCapabilities: Capability[];
  rejection: Rejected | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  views: Record<string, SessionView>;
  /** 待应答的阻塞式交互（可能来自不同会话）。 */
  interactions: UiRequest[];
  notices: SdkNotice[];
  models: { provider: string; modelId: string; name: string }[];
  editorText: string;
  reconnects: number;
};

export function emptyView(id: string): SessionView {
  return {
    id,
    summary: null,
    state: null,
    entries: [],
    seqByEntryId: {},
    maxSeq: 0,
    streaming: { text: "", thinking: "" },
    running: false,
    pendingInteractions: 0,
    usage: null,
    lastError: null,
    needsResync: false,
    readOnly: false,
  };
}

export function createInitialState(): SdkState {
  return {
    connected: false,
    coreId: null,
    trustLevel: null,
    grantedCapabilities: [],
    rejection: null,
    sessions: [],
    activeSessionId: null,
    views: {},
    interactions: [],
    notices: [],
    models: [],
    editorText: "",
    reconnects: 0,
  };
}

const MAX_NOTICES = 50;

function pushNotice(
  notices: SdkNotice[],
  level: SdkNotice["level"],
  message: string,
  at: number,
): SdkNotice[] {
  return [...notices, { level, message, at }].slice(-MAX_NOTICES);
}

function withView(
  state: SdkState,
  sessionId: string,
  update: (view: SessionView) => SessionView,
): SdkState {
  const current = state.views[sessionId] ?? emptyView(sessionId);
  return { ...state, views: { ...state.views, [sessionId]: update(current) } };
}

function upsertEntry(view: SessionView, seq: number, entry: SessionEntry): SessionView {
  if (view.seqByEntryId[entry.id] !== undefined) {
    // 同一条记录（挂载重放或续传补齐会重复投递）：按 entryId 去重，不改变已有顺序
    return view;
  }
  const entries = [...view.entries];
  let index = entries.length;
  while (index > 0) {
    const previous = entries[index - 1];
    if (previous === undefined) break;
    const previousSeq = view.seqByEntryId[previous.id] ?? 0;
    if (previousSeq <= seq) break;
    index -= 1;
  }
  entries.splice(index, 0, entry);
  return {
    ...view,
    entries,
    seqByEntryId: { ...view.seqByEntryId, [entry.id]: seq },
    maxSeq: Math.max(view.maxSeq, seq),
  };
}

/**
 * 记录到达时同步更新"会话摘要"（侧栏用）。
 *
 * 不这么做的话，列表要等下一次 `session.list` 才会更新——用户在侧栏看到的条目数会一直落后，
 * 而这恰恰是"记录已经落盘"最直观的证据。摘要只是派生数据，这里就近维护它成本最低。
 */
function touchSummary(
  state: SdkState,
  sessionId: string,
  seq: number,
  entry: SessionEntry,
): SdkState {
  const previous = state.sessions.find((session) => session.id === sessionId);
  const previousFirst = previous?.firstMessage ?? null;
  const firstMessage = previousFirst ?? firstUserText(entry) ?? null;
  const entryCount = Math.max(previous?.entryCount ?? 0, seq);
  const updatedAt = entry.timestamp;

  const sessions =
    previous === undefined
      ? state.sessions
      : state.sessions.map((session) =>
          session.id === sessionId ? { ...session, entryCount, firstMessage, updatedAt } : session,
        );

  const view = state.views[sessionId];
  const baseSummary = view?.summary ?? previous ?? null;
  const views =
    view === undefined
      ? state.views
      : {
          ...state.views,
          [sessionId]: {
            ...view,
            summary:
              baseSummary === null ? null : { ...baseSummary, entryCount, firstMessage, updatedAt },
          },
        };

  if (sessions === state.sessions && views === state.views) return state;
  return { ...state, sessions, views };
}

function firstUserText(entry: SessionEntry): string | null {
  if (entry.type !== "message") return null;
  const message = entry.message as { role?: string; content?: unknown } | undefined;
  if (message?.role !== "user") return null;
  if (typeof message.content === "string") return message.content.slice(0, 200);
  if (!Array.isArray(message.content)) return null;
  const parts: string[] = [];
  for (const part of message.content) {
    if (typeof part === "object" && part !== null && (part as { type?: string }).type === "text") {
      const text = (part as { text?: string }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length === 0 ? null : parts.join("").slice(0, 200);
}

/** 一条记录到达 = 权威信号：清掉同一条消息对应的流式增量。 */
function isAuthoritativeText(entry: SessionEntry): boolean {
  return entry.type === "message";
}

export function applyServerMessage(state: SdkState, message: ServerMessage, at: number): SdkState {
  switch (message.type) {
    case "welcome": {
      const views = { ...state.views };
      for (const session of message.sessions) {
        const view = views[session.id] ?? emptyView(session.id);
        views[session.id] = { ...view, summary: session };
      }
      const resume = message.resumeAck;
      if (resume !== null && resume.valid === false) {
        // 游标失效：显式信号，必须重新全量同步（spec §4.5）
        const view = views[resume.sessionId] ?? emptyView(resume.sessionId);
        views[resume.sessionId] = {
          ...view,
          entries: [],
          seqByEntryId: {},
          maxSeq: 0,
          needsResync: true,
        };
      }
      return {
        ...state,
        connected: true,
        coreId: message.coreId,
        trustLevel: message.trustLevel,
        grantedCapabilities: message.grantedCapabilities,
        rejection: null,
        sessions: message.sessions,
        views,
      };
    }

    case "rejected":
      return {
        ...state,
        connected: false,
        rejection: message,
        notices: pushNotice(state.notices, "error", message.message, at),
      };

    case "response":
      // 命令的应答由 sdk 的请求-应答配对消化（见 agent-sdk.ts），状态折叠里不需要处理。
      return state;

    case "entry_appended": {
      const withEntry = withView(state, message.sessionId, (view) => {
        const next = upsertEntry(view, message.seq, message.entry);
        if (next === view) return view;
        const cleared = isAuthoritativeText(message.entry)
          ? { streaming: { text: "", thinking: "" } }
          : {};
        return { ...next, ...cleared };
      });
      return touchSummary(withEntry, message.sessionId, message.seq, message.entry);
    }

    case "message_delta": {
      return withView(state, message.sessionId, (view) => {
        if (message.kind === "text") {
          return {
            ...view,
            streaming: { ...view.streaming, text: view.streaming.text + message.delta },
            running: true,
          };
        }
        if (message.kind === "thinking") {
          return {
            ...view,
            streaming: { ...view.streaming, thinking: view.streaming.thinking + message.delta },
            running: true,
          };
        }
        return { ...view, running: true };
      });
    }

    case "turn_start":
      return withView(state, message.sessionId, (view) => ({ ...view, running: true }));

    case "turn_end":
      // 一轮结束不等于完成：running 不在里落下（spec §4.5 第 2 条）
      return withView(state, message.sessionId, (view) => ({ ...view, running: true }));

    case "agent_settled":
      return withView(state, message.sessionId, (view) => ({
        ...view,
        running: false,
        streaming: { text: "", thinking: "" },
      }));

    case "usage":
      return withView(state, message.sessionId, (view) => ({ ...view, usage: message.usage }));

    case "status":
      return withView(state, message.sessionId, (view) => ({
        ...view,
        running: message.status !== "idle",
        pendingInteractions: message.pendingInteractions,
        state: view.state === null ? null : { ...view.state, status: message.status },
      }));

    case "resync_required":
      return withView(state, message.sessionId, (view) => ({
        ...view,
        entries: [],
        seqByEntryId: {},
        maxSeq: message.cursor,
        needsResync: true,
      }));

    case "ui.request":
      if (state.interactions.some((request) => request.id === message.id)) return state;
      return { ...state, interactions: [...state.interactions, message] };

    case "ui.cancel":
      return {
        ...state,
        interactions: state.interactions.filter((request) => request.id !== message.id),
      };

    case "ui.notify":
      return {
        ...state,
        notices: pushNotice(
          state.notices,
          message.level === "warn" ? "warn" : message.level,
          message.message,
          at,
        ),
      };

    case "ui.status":
      return state;

    case "ui.set_editor_text":
      return { ...state, editorText: message.value };

    case "ui.title":
    case "ui.widget":
      return state;

    default:
      return state;
  }
}

// ── 结构化展示项（给 Web/桌面的 ZCode 风格界面用；TUI 继续用 toDisplayMessages） ──

export type DisplayItem =
  | { kind: "user"; id: string; seq: number; text: string; timestamp: string }
  | {
      kind: "pending";
      id: string;
      seq: number;
      interactionId: string;
      method: string;
      params: Record<string, unknown>;
      timestamp: string;
    }
  | { kind: "assistant"; id: string; seq: number; markdown: string; timestamp: string }
  | {
      kind: "tool";
      id: string;
      seq: number;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      /** running：还没等到结果；done / error：结果已落盘。 */
      status: "running" | "done" | "error";
      output: string;
      timestamp: string;
    }
  | { kind: "thinking"; id: string; seq: number; text: string; timestamp: string }
  | { kind: "notice"; id: string; seq: number; text: string; timestamp: string }
  | { kind: "compaction"; id: string; seq: number; summary: string; timestamp: string };

/**
 * 记录 → 结构化展示项。
 *
 * 关键是**工具调用与结果配对**：基座把"调用"写在 assistant 消息的内容里（toolCall 部分，
 * 带 callId），把"结果"写成独立的 toolResult 消息（toolCallId + isError）。配对规则：
 * 先按 callId 找；找不到就挂到最近一个还在 running 的调用上（顺序兜底）。
 */
export function toDisplayItems(view: SessionView): DisplayItem[] {
  const items: DisplayItem[] = [];
  const toolByCallId = new Map<string, Extract<DisplayItem, { kind: "tool" }>>();
  let lastRunningTool: Extract<DisplayItem, { kind: "tool" }> | undefined;

  let lastAssistantEntryId: string | null = null;
  const pushAssistantText = (entry: SessionEntry, seq: number, text: string): void => {
    if (text === "") return;
    const last = items.at(-1);
    // 同一条助手消息里的多个文本段并入一项（markdown 需要连续上下文）；跨消息不合并
    if (last?.kind === "assistant" && lastAssistantEntryId === entry.id) {
      last.markdown = `${last.markdown}\n\n${text}`;
      return;
    }
    lastAssistantEntryId = entry.id;
    items.push({
      kind: "assistant",
      id: entry.id,
      seq,
      markdown: text,
      timestamp: entry.timestamp,
    });
  };

  for (const entry of view.entries) {
    const seq = view.seqByEntryId[entry.id] ?? 0;
    if (entry.type === "message") {
      const message = entry.message as
        | {
            role?: string;
            content?: unknown;
            toolCallId?: string;
            toolName?: string;
            isError?: boolean;
          }
        | undefined;
      const role = message?.role;

      if (role === "user") {
        items.push({
          kind: "user",
          id: entry.id,
          seq,
          text: renderContent(message?.content),
          timestamp: entry.timestamp,
        });
        continue;
      }
      if (role === "toolResult") {
        const callId = String(message?.toolCallId ?? "");
        const target =
          toolByCallId.get(callId) ?? (lastRunningTool !== undefined ? lastRunningTool : undefined);
        const output = renderContent(message?.content);
        if (target !== undefined) {
          target.status = message?.isError === true ? "error" : "done";
          target.output = output;
          if (lastRunningTool === target) lastRunningTool = undefined;
        } else {
          // 没配到调用（例如历史被裁剪）：仍以工具卡片呈现
          items.push({
            kind: "tool",
            id: entry.id,
            seq,
            callId,
            toolName: String(message?.toolName ?? "tool"),
            args: {},
            status: message?.isError === true ? "error" : "done",
            output,
            timestamp: entry.timestamp,
          });
        }
        continue;
      }

      // assistant / system
      if (role === "system") continue;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue;
        const record = part as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string" && record.text !== "") {
          pushAssistantText(entry, seq, record.text);
          continue;
        }
        if (record.type === "thinking" && typeof record.thinking === "string") {
          items.push({
            kind: "thinking",
            id: entry.id,
            seq,
            text: record.thinking,
            timestamp: entry.timestamp,
          });
          continue;
        }
        if (record.type === "toolCall" || record.type === "tool_use") {
          const callId = String(record.id ?? record.toolCallId ?? `call-${seq}-${items.length}`);
          const toolItem: Extract<DisplayItem, { kind: "tool" }> = {
            kind: "tool",
            id: `${entry.id}:${callId}`,
            seq,
            callId,
            toolName: String(record.name ?? record.toolName ?? "tool"),
            args: (record.arguments ?? record.input ?? {}) as Record<string, unknown>,
            status: "running",
            output: "",
            timestamp: entry.timestamp,
          };
          items.push(toolItem);
          toolByCallId.set(callId, toolItem);
          lastRunningTool = toolItem;
        }
      }
      continue;
    }

    if (entry.type === "compaction") {
      items.push({
        kind: "compaction",
        id: entry.id,
        seq,
        summary: String(entry.summary ?? ""),
        timestamp: entry.timestamp,
      });
      continue;
    }
    if (
      entry.type === "custom" &&
      (entry.customType === "ui.pending" || entry.customType === "ui.resolved")
    ) {
      // 持久化待决交互（spec §2.7 / ADR-020）：请求落盘，稍后有人来再解决。
      // 已解决的显示一行；未解决的生成可应答卡片（解决后由 ui.resolved 抹掉）。
      const data = entry.data as
        | {
            interactionId?: string;
            method?: string;
            params?: Record<string, unknown>;
            decision?: string;
          }
        | undefined;
      if (data?.interactionId === undefined) continue;
      if (entry.customType === "ui.resolved") {
        items.push({
          kind: "notice",
          id: entry.id,
          seq,
          text: `待决交互 ${data.interactionId} 已处理：${data.decision ?? "?"}`,
          timestamp: entry.timestamp,
        });
        continue;
      }
      items.push({
        kind: "pending",
        id: entry.id,
        seq,
        interactionId: data.interactionId,
        method: data.method ?? "交互",
        params: data.params ?? {},
        timestamp: entry.timestamp,
      });
      continue;
    }
    if (entry.type === "custom" && entry.customType === "tool.decision") {
      const data = entry.data as
        | { toolName?: string; approved?: boolean; reason?: string }
        | undefined;
      if (data !== undefined) {
        items.push({
          kind: "notice",
          id: entry.id,
          seq,
          text: `工具 ${data.toolName ?? "?"}：${data.approved === true ? "已放行" : "已拦截"}（${data.reason ?? ""}）`,
          timestamp: entry.timestamp,
        });
      }
    }
  }

  // 流式（非权威）：文本与思考各一条
  if (view.streaming.thinking !== "") {
    items.push({
      kind: "thinking",
      id: "__streaming_thinking__",
      seq: Number.MAX_SAFE_INTEGER - 1,
      text: view.streaming.thinking,
      timestamp: new Date().toISOString(),
    });
  }
  if (view.streaming.text !== "") {
    items.push({
      kind: "assistant",
      id: "__streaming__",
      seq: Number.MAX_SAFE_INTEGER,
      markdown: view.streaming.text,
      timestamp: new Date().toISOString(),
    });
  }
  return items;
}

/** 记录 → 展示行。工具调用与工具结果都折成一行，便于终端排版。 */
export function toDisplayMessages(view: SessionView): DisplayMessage[] {
  const rows: DisplayMessage[] = [];
  for (const entry of view.entries) {
    const seq = view.seqByEntryId[entry.id] ?? 0;
    if (entry.type === "message") {
      const message = entry.message as
        | { role?: string; content?: unknown; toolName?: string; isError?: boolean }
        | undefined;
      const role = message?.role ?? "assistant";
      const text = renderContent(message?.content);
      if (text === "") continue;
      rows.push({
        id: entry.id,
        seq,
        role:
          role === "user"
            ? "user"
            : role === "toolResult" || role === "tool"
              ? "tool"
              : "assistant",
        text,
        timestamp: entry.timestamp,
      });
      continue;
    }
    if (entry.type === "custom" && typeof entry.customType === "string") {
      const data = entry.data as
        | { toolName?: string; approved?: boolean; reason?: string }
        | undefined;
      if (entry.customType === "tool.decision" && data !== undefined) {
        rows.push({
          id: entry.id,
          seq,
          role: "notice",
          text: `工具 ${data.toolName ?? "?"}：${data.approved === true ? "已放行" : "已拦截"}（${data.reason ?? ""}）`,
          timestamp: entry.timestamp,
        });
      }
      continue;
    }
    if (entry.type === "compaction") {
      rows.push({
        id: entry.id,
        seq,
        role: "notice",
        text: `[上下文已压缩] ${String(entry.summary ?? "")}`.slice(0, 400),
        timestamp: entry.timestamp,
      });
    }
  }

  if (view.streaming.text !== "") {
    rows.push({
      id: "__streaming__",
      seq: Number.MAX_SAFE_INTEGER,
      role: "assistant",
      text: view.streaming.text,
      timestamp: new Date().toISOString(),
      streaming: true,
    });
  }
  return rows;
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (record.type === "toolCall" || record.type === "tool_use") {
      const name = String(record.name ?? record.toolName ?? "tool");
      const input = record.input ?? record.arguments ?? {};
      parts.push(`⚙ ${name} ${truncate(JSON.stringify(input), 300)}`);
      continue;
    }
    if (record.type === "image") parts.push("[图片]");
  }
  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
