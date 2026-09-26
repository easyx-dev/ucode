import {
  type AutonomyLevel,
  type Capability,
  type ClientKind,
  type CommandName,
  type ErrorInfo,
  PROTOCOL_VERSION,
  parseServerMessage,
  type Reference,
  type Response,
  type ServerMessage,
  type SessionState,
  type SessionSummary,
  type Transport,
} from "@ucode/protocol";
import {
  applyServerMessage,
  createInitialState,
  type DisplayMessage,
  emptyView,
  type SdkState,
  toDisplayMessages,
} from "./reducer.ts";

/**
 * headless 控制层 SDK（spec §7.1 的 `sdk`）：建连、命令封装、事件折叠、断线续传。
 *
 * **不含 DOM、不含 UI**：因此 TUI 能只复用 sdk，Web 与桌面复用 ui（ui 再复用 sdk）。
 * 传输是注入的（`Transport`），具体传输归绑定包——sdk 只认协议 C 的消息语义。
 */

export type ConnectOptions = {
  transport: Transport;
  clientId?: string;
  clientKind?: ClientKind;
  /** 控制层声明自己能承载什么（不是请求权限；核心层按信任矩阵决定授予什么）。 */
  capabilities?: Capability[];
  identity?: { user: string | null; device: string | null };
  /** 断线续传：带上上次收到的位置。 */
  resume?: { sessionId: string; fromSeq: number } | null;
  /** 命令应答超时（毫秒）。 */
  requestTimeoutMs?: number;
  now?: () => number;
};

export type AgentSdk = {
  readonly clientId: string;
  get state(): SdkState;
  subscribe(listener: (state: SdkState) => void): () => void;
  /** 建立连接（握手）。断开后会自动带游标重连。 */
  connect(): Promise<ServerMessage & { type: "welcome" }>;
  close(): Promise<void>;

  // 会话
  createSession(options?: {
    cwd?: string;
    name?: string;
    autonomy?: AutonomyLevel;
  }): Promise<{ sessionId: string }>;
  listSessions(): Promise<SessionSummary[]>;
  attachSession(sessionId: string): Promise<{ replayed: boolean; readOnly: boolean }>;
  detachSession(sessionId: string): Promise<void>;
  getSessionState(sessionId: string): Promise<SessionState>;
  getEntries(
    sessionId: string,
    fromSeq?: number,
    limit?: number,
  ): Promise<{ cursor: number; records: { seq: number; entry: Record<string, unknown> }[] }>;
  forkSession(sessionId: string, fromId?: string): Promise<{ sessionId: string }>;
  cloneSession(sessionId: string): Promise<{ sessionId: string }>;
  setSessionName(sessionId: string, name: string): Promise<void>;
  setAutonomy(sessionId: string, level: AutonomyLevel): Promise<void>;

  // 驱动
  prompt(sessionId: string, text: string, references?: Reference[]): Promise<void>;
  steer(sessionId: string, text: string): Promise<void>;
  followUp(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  clearQueue(sessionId: string): Promise<void>;

  // 配置与工具
  setModel(sessionId: string, provider: string, modelId: string): Promise<void>;
  listModels(): Promise<{ provider: string; modelId: string; name: string }[]>;
  setThinkingLevel(sessionId: string, level: string): Promise<void>;
  compact(sessionId: string, instructions?: string): Promise<void>;
  runBash(
    sessionId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  // 交互
  respondToInteraction(
    id: string,
    value: string | boolean | null,
    options?: { cancelled?: boolean },
  ): void;

  // 通道
  openWorkspaceChannel(sessionId: string, channelId?: string): Promise<string>;
  requestWorkspace<T = unknown>(
    channelId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;

  // 展示助手
  displayMessages(sessionId: string): DisplayMessage[];
};

/** 让定时器不阻止进程退出；浏览器里 setTimeout 返回 number，没有 unref。 */
function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

class SdkError extends Error {
  readonly info: ErrorInfo;
  constructor(info: ErrorInfo) {
    super(`${info.code}: ${info.message}`);
    this.name = "SdkError";
    this.info = info;
  }
}

export async function connect(options: ConnectOptions): Promise<AgentSdk> {
  const { transport } = options;
  const clientId = options.clientId ?? `client-${Math.random().toString(36).slice(2, 10)}`;
  const now = options.now ?? ((): number => Date.now());
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;

  let state = createInitialState();
  const listeners = new Set<(state: SdkState) => void>();
  const pendingRequests = new Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingChannels = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let counter = 0;
  let closed = false;

  const publish = (next: SdkState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  function apply(message: ServerMessage): void {
    publish(applyServerMessage(state, message, now()));
  }

  function activeSessionId(): string | null {
    return state.activeSessionId;
  }

  function cursorOf(sessionId: string): number {
    return state.views[sessionId]?.maxSeq ?? 0;
  }

  async function handshake(): Promise<ServerMessage & { type: "welcome" }> {
    const resumeSession = activeSessionId();
    const resume =
      options.resume !== null && options.resume !== undefined
        ? options.resume
        : resumeSession === null
          ? null
          : { sessionId: resumeSession, fromSeq: cursorOf(resumeSession) };
    transport.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId,
      clientKind: options.clientKind ?? "unknown",
      binding: transport.kind,
      capabilities: options.capabilities ?? [],
      auth: null,
      identity: options.identity ?? { user: null, device: null },
      resume,
    });
    const message = await waitForMessage(
      (candidate) => candidate.type === "welcome" || candidate.type === "rejected",
    );
    if (message.type === "rejected") {
      apply(message);
      throw new SdkError({ code: "version_unsupported", message: message.message });
    }
    if (message.type !== "welcome") {
      throw new SdkError({ code: "internal_error", message: "握手返回了意外的消息类型。" });
    }
    apply(message);
    return message;
  }

  const messageQueue: ServerMessage[] = [];
  const waiters: {
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }[] = [];

  function deliver(message: ServerMessage): void {
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index !== -1) {
      const waiter = waiters.splice(index, 1)[0];
      waiter?.resolve(message);
      return;
    }
    messageQueue.push(message);
    if (messageQueue.length > 500) messageQueue.shift();
  }

  function waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = requestTimeoutMs,
  ): Promise<ServerMessage> {
    const queuedIndex = messageQueue.findIndex(predicate);
    if (queuedIndex !== -1) {
      const [found] = messageQueue.splice(queuedIndex, 1);
      if (found !== undefined) return Promise.resolve(found);
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const entry = { predicate, resolve };
      waiters.push(entry);
      const timer = setTimeout(() => {
        const index = waiters.indexOf(entry);
        if (index !== -1) {
          waiters.splice(index, 1);
          reject(new Error("等待核心层消息超时"));
        }
      }, timeoutMs);
      unrefTimer(timer);
    });
  }

  transport.onMessage((raw) => {
    const type = (raw as { type?: string } | null)?.type;
    if (type === "stream.ready") {
      // 事件流（重）连上了：带游标重新握手，让核心层补齐断线期间的缺口。
      void handshake().catch(() => undefined);
      return;
    }
    if (type === "stream.ping") return;
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) return;
    const message = parsed.value;

    if (message.type === "response") {
      const pending = message.id === null ? undefined : pendingRequests.get(message.id);
      if (pending !== undefined && message.id !== null) {
        clearTimeout(pending.timer);
        pendingRequests.delete(message.id);
        pending.resolve(message);
      }
      apply(message);
      return;
    }
    if (message.type === "channel.response") {
      const pending = pendingChannels.get(message.id);
      if (pending !== undefined) {
        pendingChannels.delete(message.id);
        if (message.success) pending.resolve(message.data);
        else pending.reject(new Error(message.error ?? "通道请求失败"));
      }
      return;
    }
    deliver(message);
    apply(message);
  });

  transport.onClose(() => {
    if (closed) return;
    publish({ ...state, connected: false, reconnects: state.reconnects + 1 });
  });
  transport.onError(() => undefined);

  async function request<T>(
    command: CommandName,
    args: unknown,
    sessionId: string | null,
  ): Promise<T> {
    const id = `req-${++counter}`;
    const response = await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`命令 ${command} 超时`));
      }, requestTimeoutMs);
      unrefTimer(timer);
      pendingRequests.set(id, { resolve, reject, timer });
      transport.send({ type: "command", id, command, sessionId, args });
    });
    if (!response.success)
      throw new SdkError(response.error ?? { code: "internal_error", message: "未知错误" });
    return response.data as T;
  }

  const sdk: AgentSdk = {
    clientId,
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async connect() {
      await transport.ready();
      return handshake();
    },

    async close() {
      closed = true;
      await transport.close();
      listeners.clear();
    },

    async createSession(sessionOptions = {}) {
      const data = await request<{ sessionId: string }>(
        "session.create",
        {
          ...(sessionOptions.cwd === undefined ? {} : { cwd: sessionOptions.cwd }),
          ...(sessionOptions.name === undefined ? {} : { name: sessionOptions.name }),
          ...(sessionOptions.autonomy === undefined ? {} : { autonomy: sessionOptions.autonomy }),
        },
        null,
      );
      publish({ ...state, activeSessionId: data.sessionId });
      await sdk.listSessions().catch(() => undefined);
      return data;
    },

    async listSessions() {
      const data = await request<{ sessions: SessionSummary[] }>("session.list", {}, null);
      const views = { ...state.views };
      for (const session of data.sessions) {
        const view = views[session.id] ?? emptyView(session.id);
        views[session.id] = { ...view, summary: session };
      }
      publish({ ...state, sessions: data.sessions, views });
      return data.sessions;
    },

    async attachSession(sessionId) {
      const data = await request<{ replayed: boolean; readOnly: boolean }>(
        "session.attach",
        {},
        sessionId,
      );
      publish({ ...state, activeSessionId: sessionId });
      await sdk.getSessionState(sessionId).catch(() => undefined);
      return data;
    },

    async detachSession(sessionId) {
      await request("session.detach", {}, sessionId);
      if (state.activeSessionId === sessionId) publish({ ...state, activeSessionId: null });
    },

    async getSessionState(sessionId) {
      const data = await request<{ state: SessionState }>("session.get_state", {}, sessionId);
      const view = state.views[sessionId] ?? emptyView(sessionId);
      publish({ ...state, views: { ...state.views, [sessionId]: { ...view, state: data.state } } });
      return data.state;
    },

    async getEntries(sessionId, fromSeq = 0, limit) {
      const data = await request<{
        cursor: number;
        records: { seq: number; entry: Record<string, unknown> }[];
      }>("session.get_entries", { fromSeq, ...(limit === undefined ? {} : { limit }) }, sessionId);
      // 缺口补齐也走折叠：按 seq 去重与排序
      for (const record of data.records) {
        apply({
          type: "entry_appended",
          sessionId,
          seq: record.seq,
          entry: record.entry as never,
        });
      }
      return data;
    },

    async forkSession(sessionId, fromId) {
      const data = await request<{ sessionId: string }>(
        "session.fork",
        { fromId: fromId ?? null },
        sessionId,
      );
      await sdk.listSessions().catch(() => undefined);
      return data;
    },

    async cloneSession(sessionId) {
      const data = await request<{ sessionId: string }>("session.clone", {}, sessionId);
      await sdk.listSessions().catch(() => undefined);
      return data;
    },

    async setSessionName(sessionId, name) {
      await request("session.set_name", { name }, sessionId);
      await sdk.listSessions().catch(() => undefined);
    },

    async setAutonomy(sessionId, level) {
      await request("session.set_autonomy", { level }, sessionId);
      await sdk.getSessionState(sessionId).catch(() => undefined);
    },

    async prompt(sessionId, text, references) {
      await request(
        "prompt",
        { text, ...(references === undefined ? {} : { references }) },
        sessionId,
      );
    },

    async steer(sessionId, text) {
      await request("steer", { text }, sessionId);
    },

    async followUp(sessionId, text) {
      await request("follow_up", { text }, sessionId);
    },

    async abort(sessionId) {
      await request("abort", {}, sessionId);
    },

    async clearQueue(sessionId) {
      await request("clear_queue", {}, sessionId);
    },

    async setModel(sessionId, provider, modelId) {
      await request("model.set", { provider, modelId }, sessionId);
      await sdk.getSessionState(sessionId).catch(() => undefined);
    },

    async listModels() {
      const data = await request<{ models: { provider: string; modelId: string; name: string }[] }>(
        "model.list",
        {},
        null,
      );
      publish({ ...state, models: data.models });
      return data.models;
    },

    async setThinkingLevel(sessionId, level) {
      await request("thinking.set", { level }, sessionId);
      await sdk.getSessionState(sessionId).catch(() => undefined);
    },

    async compact(sessionId, instructions) {
      await request(
        "compact",
        { ...(instructions === undefined ? {} : { instructions }) },
        sessionId,
      );
    },

    async runBash(sessionId, command) {
      return request<{ stdout: string; stderr: string; exitCode: number }>(
        "bash",
        { command },
        sessionId,
      );
    },

    respondToInteraction(id, value, responseOptions = {}) {
      publish({
        ...state,
        interactions: state.interactions.filter((request) => request.id !== id),
      });
      transport.send({
        type: "ui.response",
        id,
        cancelled: responseOptions.cancelled ?? false,
        value,
        responderId: clientId,
      });
    },

    async openWorkspaceChannel(sessionId, channelId = `ws-${++counter}`) {
      await sdk.attachSession(sessionId).catch(() => undefined);
      transport.send({ type: "channel.open", channelId, channel: "workspace", params: {} });
      await waitForMessage(
        (message) => message.type === "channel.opened" || message.type === "channel.closed",
      );
      return channelId;
    },

    async requestWorkspace<T>(channelId: string, method: string, params?: Record<string, unknown>) {
      const id = `chan-${++counter}`;
      const result = new Promise<unknown>((resolve, reject) => {
        pendingChannels.set(id, { resolve, reject });
        const timer = setTimeout(() => {
          if (pendingChannels.delete(id)) reject(new Error(`通道请求 ${method} 超时`));
        }, requestTimeoutMs);
        unrefTimer(timer);
      });
      transport.send({ type: "channel.request", id, channelId, method, params: params ?? {} });
      return (await result) as T;
    },

    displayMessages(sessionId) {
      const view = state.views[sessionId];
      return view === undefined ? [] : toDisplayMessages(view);
    },
  };

  return sdk;
}
