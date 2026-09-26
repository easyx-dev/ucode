import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  type ModelRuntime,
  type SessionEntry as PiSessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionRecord, SessionRepo } from "@ucode/data-layer-spec";
import type {
  AutonomyLevel,
  Reference,
  SessionEntry,
  SessionEvent,
  SessionState,
  SessionTreeNode,
} from "@ucode/protocol";
import { createToolGateExtension } from "./tool-gate.ts";

/**
 * 会话运行时：**包住基座的 agent session**（spec §7.1「session-runtime 包住 agent session」）。
 *
 * 三条不变量在这里落地：
 *
 * 1. **store 是唯一写会话文件者**。基座的会话管理用内存态（`SessionManager.inMemory`），
 *    磁盘写入全部经 store 的 append。这样"核心层不得绕过 store 直接读写会话文件"是结构性的，
 *    而不是靠约定。
 * 2. **先落盘，再广播**（spec §3.6）。每个事件之后我们把内存态管理器里新增的记录追加进 store，
 *    `append` 返回（含 fsync）之后才把 `entry_appended` 广播出去。
 * 3. **游标 = 行序号**。`entry_appended.seq` 直接来自 store 的追加结果，控制层据此断线续传。
 *
 * 之所以要"按差异落盘"而不是订阅基座的 `entry_appended`：实测该事件在正常对话路径上**不会触发**
 * （它只覆盖扩展追加、上下文编辑等少量路径）。差异比对反而更稳：任何类型的记录都会被发现。
 */

export type SessionRuntimeOptions = {
  sessionId: string;
  cwd: string;
  dataDir: string;
  repo: SessionRepo;
  modelRuntime: ModelRuntime;
  autonomy: AutonomyLevel;
  uiContext: ExtensionUIContext;
  now?: () => Date;
  /** 事件出口（核心层负责广播）。 */
  onEvent: (event: SessionEvent) => void;
  /** 状态变化（忙闲、待决交互数）。 */
  onStatusChange: () => void;
  /** 待决交互数（由 ui-broker 提供）。 */
  pendingInteractions: () => number;
  /** attachment 数（由核心层提供）。 */
  attachments: () => number;
  /** 降级/拦截等需要记录在案的决策。 */
  onDecision?: (decision: { toolName: string; approved: boolean; reason: string }) => void;
};

export class SessionRuntime {
  readonly sessionId: string;
  readonly cwd: string;

  #repo: SessionRepo;
  #manager: SessionManager;
  #session: AgentSession | undefined;
  #autonomy: AutonomyLevel;
  /** 决策记忆（F-1.10）：本会话内被"总是允许"的工具。 */
  readonly sessionAllowedTools = new Set<string>();
  #status: SessionState["status"] = "idle";
  #persisted = 0;
  #lastPersistedId: string | null = null;
  #deltaIndex = 0;
  #persistChain: Promise<void> = Promise.resolve();
  #disposed = false;
  #options: SessionRuntimeOptions;
  #unsubscribe: (() => void) | undefined;

  private constructor(options: SessionRuntimeOptions, repo: SessionRepo, manager: SessionManager) {
    this.#options = options;
    this.#repo = repo;
    this.#manager = manager;
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.#autonomy = options.autonomy;
  }

  /**
   * 新建或恢复会话运行时。
   *
   * 两条路径合成一条：store 负责建文件/读记录，运行时只拿"记录 + 内存态管理器"。
   * 记录由数据层给出（权威），因此"会话恢复"就是"把已落盘的记录喂回管理器"（V-8 已验证可行）。
   */
  static async open(
    options: SessionRuntimeOptions,
    entries: SessionEntry[],
  ): Promise<SessionRuntime> {
    const seeded = entries as unknown as PiSessionEntry[];
    const manager = SessionManager.inMemory(options.cwd, { id: options.sessionId }, seeded);
    const runtime = new SessionRuntime(options, options.repo, manager);
    runtime.#persisted = seeded.length;
    runtime.#lastPersistedId = seeded.at(-1)?.id ?? null;
    await runtime.#start();
    return runtime;
  }

  async #start(): Promise<void> {
    const options = this.#options;
    const resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.dataDir,
      extensionFactories: [
        createToolGateExtension({
          autonomy: () => this.#autonomy,
          sessionAllowed: this.sessionAllowedTools,
          onDecision: options.onDecision,
        }),
      ],
    });
    await resourceLoader.reload();

    const model = await pickModel(options.modelRuntime, options.dataDir);
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.dataDir,
      modelRuntime: options.modelRuntime,
      ...(model === undefined ? {} : { model }),
      resourceLoader,
      sessionManager: this.#manager,
    });

    await session.bindExtensions({
      uiContext: options.uiContext,
      mode: "rpc",
      abortHandler: () => {
        void session.abort();
      },
    });

    this.#session = session;
    this.#unsubscribe = session.subscribe((event) => {
      void this.#onPiEvent(event as PiEvent).catch(() => {
        // 单个事件转译失败不该让会话崩掉：状态由下一次落盘对账修正。
      });
    });
    this.#emitStatus();
  }

  get session(): AgentSession {
    if (this.#session === undefined) throw new Error("会话运行时尚未启动");
    return this.#session;
  }

  get autonomy(): AutonomyLevel {
    return this.#autonomy;
  }

  setAutonomy(level: AutonomyLevel): void {
    this.#autonomy = level;
    this.#emitStatus();
  }

  get status(): SessionState["status"] {
    return this.#status;
  }

  /** 状态快照：控制层据它渲染。 */
  state(): SessionState {
    const session = this.#session;
    const model = session?.model;
    return {
      sessionId: this.sessionId,
      name: session?.sessionName ?? null,
      cwd: this.cwd,
      model: model === undefined ? null : { provider: model.provider, modelId: model.id },
      thinkingLevel: session?.thinkingLevel ?? null,
      autonomy: this.#autonomy,
      status: this.#deriveStatus(),
      cursor: this.#persisted,
      pendingMessages: session?.pendingMessageCount ?? 0,
      pendingInteractions: this.#options.pendingInteractions(),
      attachments: this.#options.attachments(),
    };
  }

  #deriveStatus(): SessionState["status"] {
    const session = this.#session;
    if (this.#options.pendingInteractions() > 0) return "waiting";
    if (session === undefined) return this.#status;
    if (session.isCompacting) return "compacting";
    if (session.isRetrying) return "retrying";
    if (session.isStreaming) return "running";
    return this.#status === "waiting" ? "waiting" : "idle";
  }

  /** 从数据层读权威记录（不是从内存态管理器读）。 */
  async records(fromSeq = 0, limit?: number): Promise<SessionRecord[]> {
    return this.#repo.read(fromSeq, limit);
  }

  async entries(): Promise<SessionEntry[]> {
    return this.#repo.entries();
  }

  /** 分支结构：由 parentId 构成的树（分支不复制历史）。 */
  async tree(): Promise<SessionTreeNode[]> {
    const entries = await this.#repo.entries();
    const nodes = new Map<string, SessionTreeNode>(
      entries.map((entry) => [entry.id, { entry, children: [] }]),
    );
    const roots: SessionTreeNode[] = [];
    for (const entry of entries) {
      const node = nodes.get(entry.id);
      if (node === undefined) continue;
      const parent = entry.parentId === null ? undefined : nodes.get(entry.parentId);
      if (parent === undefined) roots.push(node);
      else parent.children.push(node);
    }
    return roots;
  }

  async startPrompt(text: string, references?: Reference[]): Promise<void> {
    const expanded = expandReferences(text, references);
    this.#status = "running";
    this.#deltaIndex = 0;
    this.#emitStatus();
    await this.session.prompt(expanded);
    // prompt() 在整轮结束后返回；这里再对账一次，确保最后的记录也落盘了。
    await this.#persistNewEntries();
    this.#emitStatus();
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
  }

  async abort(): Promise<void> {
    await this.session.abort();
    this.#emitStatus();
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const cleared = this.session.clearQueue();
    this.#emitStatus();
    return { steering: [...cleared.steering], followUp: [...cleared.followUp] };
  }

  async setModel(provider: string, modelId: string): Promise<boolean> {
    const model = this.#options.modelRuntime.getModel(provider, modelId);
    if (model === undefined) return false;
    await this.session.setModel(model);
    await this.#persistNewEntries();
    this.#emitStatus();
    return true;
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.session.setThinkingLevel(level as never);
    await this.#persistNewEntries();
    this.#emitStatus();
  }

  async compact(instructions?: string): Promise<void> {
    this.#status = "compacting";
    this.#emitStatus();
    try {
      await this.session.compact(instructions);
      await this.#persistNewEntries();
    } finally {
      this.#status = "idle";
      this.#emitStatus();
    }
  }

  async setName(name: string): Promise<void> {
    this.session.setSessionName(name);
    await this.#persistNewEntries();
    this.#emitStatus();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    await this.#persistNewEntries();
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#session?.dispose();
  }

  // ── 落盘与事件 ──

  /** 把内存态管理器里新增的记录按顺序写进数据层，然后逐条广播（先落盘再广播）。 */
  async #persistNewEntries(): Promise<void> {
    this.#persistChain = this.#persistChain.then(async () => {
      const entries = this.#manager.getEntries();

      // 追加式校验：已落盘的最后一条仍应是管理器里的同一条。
      // 不是的话说明管理器被整体替换（例如基座做了格式迁移）→ 交给上层重新全量同步。
      if (this.#persisted > 0) {
        const anchor = entries[this.#persisted - 1];
        if (anchor === undefined || anchor.id !== this.#lastPersistedId) {
          this.#options.onEvent({
            type: "resync_required",
            sessionId: this.sessionId,
            reason: "migration",
            cursor: 0,
          });
          this.#persisted = 0;
          this.#lastPersistedId = null;
        }
      }

      for (let index = this.#persisted; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const record = await this.#repo.append(
          entry as unknown as Record<string, unknown> & { type: string },
        );
        this.#persisted = record.seq;
        this.#lastPersistedId = record.entry.id;
        this.#options.onEvent({
          type: "entry_appended",
          sessionId: this.sessionId,
          seq: record.seq,
          entry: record.entry,
        });
      }
      this.#emitStatus();
    });
    await this.#persistChain;
  }

  async #onPiEvent(event: PiEvent): Promise<void> {
    switch (event.type) {
      case "message_update": {
        const inner = event.assistantMessageEvent;
        const delta = describeDelta(inner);
        if (delta !== undefined) {
          this.#options.onEvent({
            type: "message_delta",
            sessionId: this.sessionId,
            kind: delta.kind,
            delta: delta.text,
            index: this.#deltaIndex++,
          });
        }
        return;
      }
      case "turn_start": {
        this.#options.onEvent({ type: "turn_start", sessionId: this.sessionId });
        this.#status = "running";
        this.#emitStatus();
        return;
      }
      case "turn_end": {
        await this.#persistNewEntries();
        this.#options.onEvent({
          type: "turn_end",
          sessionId: this.sessionId,
          entryId: (event as { messageEntryId?: string }).messageEntryId ?? null,
          toolResultIds: (event as { toolResultEntryIds?: string[] }).toolResultEntryIds ?? [],
        });
        return;
      }
      case "agent_end": {
        await this.#persistNewEntries();
        return;
      }
      case "agent_settled": {
        await this.#persistNewEntries();
        this.#options.onEvent({ type: "agent_settled", sessionId: this.sessionId });
        this.#status = "idle";
        this.#emitStatus();
        return;
      }
      case "usage": {
        this.#options.onEvent({
          type: "usage",
          sessionId: this.sessionId,
          usage: (event as { usage?: Record<string, unknown> }).usage ?? {},
        });
        return;
      }
      case "compaction_start": {
        this.#status = "compacting";
        this.#emitStatus();
        return;
      }
      case "compaction_end": {
        await this.#persistNewEntries();
        this.#status = "idle";
        this.#emitStatus();
        return;
      }
      case "auto_retry_start": {
        this.#status = "retrying";
        this.#emitStatus();
        return;
      }
      case "auto_retry_end": {
        this.#status = "idle";
        this.#emitStatus();
        return;
      }
      case "thinking_level_changed":
      case "session_info_changed": {
        await this.#persistNewEntries();
        return;
      }
      case "queue_update": {
        this.#emitStatus();
        return;
      }
      default: {
        // message_start / message_end / tool_execution_* 等：记录由差异落盘覆盖，
        // 这里只需保证状态正确。
        if (event.type === "message_end" || event.type === "tool_execution_end") {
          await this.#persistNewEntries();
        }
      }
    }
  }

  #emitStatus(): void {
    this.#options.onStatusChange();
  }
}

type PiEvent = {
  type: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  [key: string]: unknown;
};

function describeDelta(
  event: { type?: string; delta?: string } | undefined,
): { kind: "text" | "thinking" | "tool_input"; text: string } | undefined {
  if (event?.delta === undefined || event.type === undefined) return undefined;
  if (event.type === "text_delta") return { kind: "text", text: event.delta };
  if (event.type === "thinking_delta") return { kind: "thinking", text: event.delta };
  if (event.type === "toolcall_delta") return { kind: "tool_input", text: event.delta };
  return undefined;
}

/**
 * 命令引用参数（spec §4.4）：首发只实现 file / folder，其余显式拒绝而不是静默忽略。
 */
export function expandReferences(text: string, references: Reference[] | undefined): string {
  if (references === undefined || references.length === 0) return text;
  const lines: string[] = [];
  for (const reference of references) {
    if (reference.kind === "file" || reference.kind === "folder") {
      lines.push(`- ${reference.kind === "file" ? "文件" : "目录"}：${reference.id}`);
      continue;
    }
    throw new UnsupportedReferenceError(reference.kind);
  }
  return `${text}\n\n引用：\n${lines.join("\n")}`;
}

export class UnsupportedReferenceError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`引用类型 ${kind} 尚未实现（首发只支持文件与文件夹）。`);
    this.name = "UnsupportedReferenceError";
    this.kind = kind;
  }
}

/** 选模型：优先数据层 settings.json 里的默认模型，否则取第一个可用的。 */
type AvailableModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

async function pickModel(
  modelRuntime: ModelRuntime,
  dataDir?: string,
): Promise<AvailableModel | undefined> {
  if (dataDir !== undefined) {
    try {
      const raw = JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")) as {
        defaultProvider?: string;
        defaultModel?: string;
      };
      if (raw.defaultProvider !== undefined && raw.defaultModel !== undefined) {
        const configured = modelRuntime.getModel(raw.defaultProvider, raw.defaultModel);
        if (configured !== undefined) return configured;
      }
    } catch {
      // 没有 settings.json 或格式不对：退回"第一个可用模型"
    }
  }
  const available = await modelRuntime.getAvailable();
  return available[0];
}
