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
import { createGoalExtension } from "./goal/extension.ts";
import { createHooksExtension } from "./hooks/extension.ts";
import { createImportExtension } from "./import/extension.ts";
import { createMemoryExtension } from "./memory/extension.ts";
import { createSshExtension } from "./ssh/extension.ts";
import { createSubagentsExtension } from "./subagents/extension.ts";
import { createToolGateExtension } from "./tool-gate.ts";
import { createUndoExtension } from "./undo/extension.ts";
import { createWikiExtension } from "./wiki/extension.ts";

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
  /** 会话有没有可用模型。**未配置时置 false**，发送前据此直接报错（见 startPrompt）。 */
  #modelAvailable: boolean | undefined = undefined;
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
        createMemoryExtension({ dataDir: options.dataDir, cwd: options.cwd }),
        createSubagentsExtension({
          dataDir: options.dataDir,
          cwd: options.cwd,
          modelRuntime: options.modelRuntime,
          autonomy: () => this.#autonomy,
          sessionAllowed: this.sessionAllowedTools,
        }),
        createGoalExtension({
          dataDir: options.dataDir,
          cwd: options.cwd,
          modelRuntime: options.modelRuntime,
          autonomy: () => this.#autonomy,
        }),
        createUndoExtension(),
        createWikiExtension({
          dataDir: options.dataDir,
          cwd: options.cwd,
          modelRuntime: options.modelRuntime,
        }),
        createSshExtension({ dataDir: options.dataDir }),
        createImportExtension({ dataDir: options.dataDir, cwd: options.cwd }),
        createHooksExtension({
          dataDir: options.dataDir,
          cwd: options.cwd,
          sessionId: options.sessionId,
          onDecision: (decision) =>
            options.onDecision?.({
              toolName: decision.hook,
              approved: decision.approved,
              reason: `hook:${decision.event}:${decision.reason}`,
            }),
        }),
      ],
    });
    await resourceLoader.reload();

    const model = await pickModel(options.modelRuntime, options.dataDir);
    this.#modelAvailable = model !== undefined;
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
      modelAvailable: this.#modelAvailable ?? model !== undefined,
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
    // 没有可用模型就**明确报错**，而不是把这一轮咽下去。
    // 之前这里会走完流程却什么也没发生：界面上看不出任何异常，
    // 用户只能看到"发出去没反应"（实测过，排查成本极高）。
    if (this.#modelAvailable === false) {
      throw new Error(
        "还没有可用的模型：请在「模型配置」里添加一个供应商（端点 + 模型 + 密钥），或运行 `provider add`。",
      );
    }
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
    this.#modelAvailable = true;
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

  /**
   * 编辑历史对话（F-1.3）：对某条已落的记录做**追加式的上下文改写**。
   *
   * 关键取舍：不就地改文件里的旧记录（那会破坏"只追加"这条承重假设，V-1），
   * 而是追加一条 `context_edit`——原记录仍在（可追溯），模型上下文按最新编辑生效。
   * `content` 为 null 表示把该条从上下文里剔除。
   */
  async editEntry(targetId: string, content: string | null): Promise<void> {
    this.#manager.appendContextEdit(targetId, content === null ? null : { content });
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
        // **#persisted 数的是管理器条目的下标**，不是仓库的行号——仓库里还有别的
        // 写入者（待决交互、审计记录等）会插入非 agent 记录，行号会超前于管理器
        // 的条目数。混用两者会让锚点检查永远失配，每次事件都触发全量重同步（实测）。
        this.#persisted = index + 1;
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

/**
 * 选模型：数据层 settings.json 的默认 → 用户自配的供应商 → 第一个可用的。
 *
 * 中间那一档不是锦上添花：`getAvailable()[0]` 的顺序由基座决定，**当用户自配的
 * 供应商 id 与基座内置供应商重名时，内置模型会排到前面**（实测：id 写 `deepseek`
 * 时首个可用模型是内置的 `deepseek-flash`，用户声明的 `deepseek-v4-flash` 被跳过，
 * 请求因而发到一个端点不认识的模型上）。优先用户自己写进 `models.json` 的那些，
 * 才符合"本地配置是唯一来源"。
 */
type AvailableModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

async function pickModel(
  modelRuntime: ModelRuntime,
  dataDir?: string,
): Promise<AvailableModel | undefined> {
  const available = await modelRuntime.getAvailable();
  if (dataDir === undefined) return available[0];

  const settings = await readJsonFile<{ defaultProvider?: string; defaultModel?: string }>(
    join(dataDir, "settings.json"),
  );
  if (settings?.defaultProvider !== undefined && settings.defaultModel !== undefined) {
    const configured = modelRuntime.getModel(settings.defaultProvider, settings.defaultModel);
    if (configured !== undefined) return configured;
  }

  const modelsConfig = await readJsonFile<{ providers?: Record<string, unknown> }>(
    join(dataDir, "models.json"),
  );
  const ownProviders = Object.keys(modelsConfig?.providers ?? {});
  for (const provider of ownProviders) {
    const preferred = available.find((model) => model.provider === provider);
    if (preferred !== undefined) return preferred;
  }
  return available[0];
}

/** 读一个 JSON 配置；不存在、不可读或不是对象都当作"没配"，不抛。 */
async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}
