import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type AutonomyLevel,
  type Capability,
  type ClientMessage,
  COMMAND_CAPABILITIES,
  type CommandName,
  commandArgs,
  type ErrorCode,
  errorResponse,
  type Hello,
  okResponse,
  parseClientMessage,
  parseCommand,
  parseErrorResponse,
  type Response,
  requiresTrustToDrive,
  type SessionEntry,
  type SessionEvent,
  type SessionState,
  type SessionStatus,
  type SessionTreeNode,
  type TrustLevel,
  type UiResponse,
  type UsageStatsResult,
} from "@ucode/protocol";
import {
  canDriveUnattended,
  canRespondToInteraction,
  coreCapabilities,
} from "./capability/trust.ts";
import {
  addProviderConfig,
  createModelRuntime,
  deleteProviderConfig,
  listModels,
  listProviderSummaries,
} from "./config/models.ts";
import { handleHello, toSummary } from "./handshake.ts";
import { UiBroker } from "./interaction/ui-broker.ts";
import { createExtensionUiContext } from "./interaction/ui-context.ts";
import {
  applyMigration,
  collectUsageStats,
  exportSupportBundle,
  preflightMigration,
  summarizeUsage,
} from "./modules/insights/index.ts";
import {
  addSource,
  findSource,
  installPlugin,
  listInstalled,
  listSources,
  readCatalog,
  removeSource,
  summarizeInstall,
  uninstallPlugin,
} from "./modules/marketplace/index.ts";
import { type AutomationTask, type TaskRunOutcome, TaskScheduler } from "./modules/tasks/index.ts";
import { createEphemeralRepo } from "./session/ephemeral-repo.ts";
import { SessionRuntime, UnsupportedReferenceError } from "./session/runtime.ts";
import type { ServiceStore, SessionRepo } from "./storage/index.ts";
import type {
  AttachConnectionOptions,
  AttachmentView,
  ConnectionHandle,
  Service,
  ServiceBus,
  ServiceConfig,
} from "./types.ts";

export type {
  AttachConnectionOptions,
  AttachmentView,
  ConnectionHandle,
  Service,
  ServiceBus,
  ServiceConfig,
} from "./types.ts";

import { newChannelId, openPtyChannel, type PtyChannel } from "./channels/pty.ts";
import { gitChanges, gitLog, workspaceRead, workspaceTree } from "./channels/workspace.ts";
import { createServiceStore } from "./storage/index.ts";

/**
 * 服务层（协议 C 的服务端实现，spec §4.1）。
 *
 * 职责：会话生命周期、agent loop（包住基座）、工具执行、资源与插件、**人类交互中转**、持久化。
 * 它**不渲染界面**，也**不知道对端是什么传输**：绑定层把消息解出来交给这里，把这里给的消息写回连接。
 */

class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}

type ConnectionState = {
  id: string;
  options: AttachConnectionOptions;
  hello: Hello | null;
  trustLevel: TrustLevel;
  granted: Capability[];
  attachmentSessionId: string | null;
};

type RuntimeEntry = {
  /** 运行时在会话第一次被打开时建立，此后由它驱动 agent。 */
  runtime: SessionRuntime | undefined;
  repo: SessionRepo;
};

export async function createService(config: ServiceConfig): Promise<Service> {
  const coreId = config.coreId ?? `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
  const store: ServiceStore =
    config.overrides?.store ?? (await createServiceStore({ root: config.dataDir }));
  // 可变：供应商配置写入后必须**重建**运行时才能看到新模型（基座的 ModelRuntime 没有 reload）。
  let modelRuntime: ModelRuntime = await createModelRuntime(store.paths);
  const defaultCwd = config.cwd ?? process.cwd();
  const interactionTimeoutMs = config.interactionTimeoutMs ?? 120_000;
  const defaultAutonomy: AutonomyLevel = config.defaultAutonomy ?? "confirm";

  const connections = new Map<string, ConnectionState>();
  const runtimes = new Map<string, RuntimeEntry>();
  /** PTY 通道注册表：通道随连接断开而关闭（防孤儿 shell）。 */
  const ptyChannels = new Map<string, { channel: PtyChannel; connectionId: string }>();

  const bus: ServiceBus = {
    attachmentsFor(sessionId): AttachmentView[] {
      const views: AttachmentView[] = [];
      for (const connection of connections.values()) {
        if (connection.attachmentSessionId !== sessionId) continue;
        views.push({
          connectionId: connection.id,
          sessionId,
          capabilities: connection.granted,
          trustLevel: connection.trustLevel,
          clientKind: connection.hello?.clientKind ?? "unknown",
          identity: connection.hello?.identity ?? { user: null, device: null },
        });
      }
      return views;
    },
    sendTo(connectionId, message): void {
      connections.get(connectionId)?.options.send(message);
    },
    broadcastToSession(sessionId, message): void {
      for (const attachment of bus.attachmentsFor(sessionId)) {
        bus.sendTo(attachment.connectionId, message);
      }
    },
    notifyStatus(sessionId, status, pendingInteractions): void {
      // 队列计数在这里统一取，而不是让每个调用点自己传：状态事件的语义是"会话现在什么样"，
      // 漏传一处就会出现"某个壳的队列数突然归零"的假象。
      const pendingMessages = runtimes.get(sessionId)?.runtime?.state().pendingMessages ?? 0;
      bus.broadcastToSession(sessionId, {
        type: "status",
        sessionId,
        status,
        pendingInteractions,
        pendingMessages,
      });
    },
  };

  const broker = new UiBroker({
    bus,
    defaultTimeoutMs: interactionTimeoutMs,
    onNoCapacity: (request) => {
      // 没有可承载交互的 attachment：**持久化待决**（spec §2.7 / ADR-020）——
      // 请求写入数据层，会话进入等待态；任何人/任何设备/任何时间应答后恢复。
      // 当前这轮工具调用按策略拒绝（无人应答不放行），agent 会在下一轮得到转达。
      if (request.sessionId === null) return;
      void persistPendingInteraction(request.sessionId, request).catch(() => undefined);
    },
  });

  /** 审计：把关键决策作为自定义记录写进会话（协议 D 的合法用法，数据层里可追溯）。 */
  async function recordDecision(sessionId: string, kind: string, data: unknown): Promise<void> {
    const entry = runtimes.get(sessionId);
    if (entry === undefined) return;
    try {
      const record = await entry.repo.append({ type: "custom", customType: kind, data });
      bus.broadcastToSession(sessionId, {
        type: "entry_appended",
        sessionId,
        seq: record.seq,
        entry: record.entry,
      });
    } catch {
      // 审计失败不影响主流程
    }
  }

  /**
   * 把待决交互写进会话（协议 D 的合法用法：追加式表达状态）。
   * 重启后 openRuntime 时从记录里恢复（unresolved 的 ui.pending → 重新可应答）。
   */
  async function persistPendingInteraction(
    sessionId: string,
    request: { id: string; method: string; params: unknown; origin: string },
  ): Promise<void> {
    const entry = runtimes.get(sessionId);
    if (entry === undefined) return;
    const interactionId = `pending-${randomBytes(4).toString("hex")}`;
    const record = await entry.repo.append({
      type: "custom",
      customType: "ui.pending",
      data: {
        interactionId,
        method: request.method,
        params: request.params,
        origin: request.origin,
        askedAt: new Date().toISOString(),
      },
    });
    bus.broadcastToSession(sessionId, {
      type: "entry_appended",
      sessionId,
      seq: record.seq,
      entry: record.entry,
    });
    bus.notifyStatus(sessionId, "waiting", 1);
  }

  /** 解决持久化待决交互：标记已解决，并向 agent 转达决定（它据此继续工作）。 */
  async function resolvePendingInteraction(
    sessionId: string,
    interactionId: string,
    value: string | boolean | null,
    cancelled: boolean,
    connection: ConnectionState,
  ): Promise<boolean> {
    const entry = runtimes.get(sessionId);
    if (entry === undefined) return false;
    const entries = await entry.repo.entries();
    const pending = [...entries]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "custom" &&
          candidate.customType === "ui.pending" &&
          (candidate.data as { interactionId?: string } | undefined)?.interactionId ===
            interactionId,
      );
    if (pending === undefined) return false;
    const alreadyResolved = [...entries]
      .reverse()
      .some(
        (candidate) =>
          candidate.type === "custom" &&
          candidate.customType === "ui.resolved" &&
          (candidate.data as { interactionId?: string } | undefined)?.interactionId ===
            interactionId,
      );
    if (alreadyResolved) return false;

    const decision = cancelled ? "cancelled" : String(value);
    const record = await entry.repo.append({
      type: "custom",
      customType: "ui.resolved",
      data: { interactionId, decision, by: connection.id, resolvedAt: new Date().toISOString() },
    });
    bus.broadcastToSession(sessionId, {
      type: "entry_appended",
      sessionId,
      seq: record.seq,
      entry: record.entry,
    });

    // 向 agent 转达：这一轮是新的 prompt（释放等待态后恢复工作的方式，V-8 的约束下
    // pi 没有现成挂起点，我们用"记录在案 + 明确转达"实现同样的语义）。
    const gate = pending.data as { method?: string; params?: { title?: string; message?: string } };
    const text =
      `此前有一个待决交互（${gate?.method ?? "交互"}）当时无人应答，现在有了答复：${decision}。` +
      `请据此继续：若已允许，请重试该操作；若已拒绝或取消，请调整方案。`;
    writable(entry)
      .runtime.startPrompt(text)
      .catch((error: unknown) => {
        // 转达失败必须可见（否则用户以为应答生效了，agent 却毫无动静）
        bus.broadcastToSession(sessionId, {
          type: "ui.notify",
          level: "error",
          message: `待决交互的答复转达失败：${error instanceof Error ? error.message : String(error)}`,
          sessionId,
        });
      });
    bus.notifyStatus(sessionId, "running", 0);
    return true;
  }

  function statusOf(entry: RuntimeEntry): SessionStatus {
    const status = entry.runtime?.status ?? "idle";
    return status === "idle" ? "idle" : status;
  }

  /** 会话状态：owner 挂载问运行时；跟随挂载用数据层的事实合成（不假装知道对方在忙什么）。 */
  async function stateOf(entry: RuntimeEntry): Promise<SessionState> {
    if (entry.runtime !== undefined) return entry.runtime.state();
    const header = await entry.repo.readHeader();
    return {
      sessionId: entry.repo.id,
      name: null,
      cwd: header.cwd,
      model: null,
      thinkingLevel: null,
      autonomy: defaultAutonomy,
      status: "idle",
      cursor: await entry.repo.count(),
      pendingMessages: 0,
      pendingInteractions: 0,
      attachments: bus.attachmentsFor(entry.repo.id).length,
      // 跟随挂载不建运行时，也就无从判断模型：报"有"，让真正的拒绝发生在 owner 那一侧。
      modelAvailable: true,
    };
  }

  async function openRuntime(
    sessionId: string,
    /** 临时会话（F-1.5）自带内存仓库：跳过会话文件查找。 */
    override?: { repo: SessionRepo },
  ): Promise<RuntimeEntry> {
    const existing = runtimes.get(sessionId);
    if (existing !== undefined) return existing;

    const repo = override?.repo ?? (await store.openSession(sessionId));
    if (repo === undefined) throw new ServiceError("session_not_found", `会话不存在：${sessionId}`);

    const runtime = await SessionRuntime.open(
      {
        sessionId,
        cwd: repo.cwd,
        root: store.paths.root,
        piDir: store.paths.piDir,
        repo,
        modelRuntime,
        autonomy: defaultAutonomy,
        uiContext: createExtensionUiContext({
          sessionId,
          broker,
          broadcast: (message) => bus.broadcastToSession(sessionId, message),
          // F-1.11：提问超时/无人承载 → 不让整轮挂死，转达"按最佳判断继续"。
          onUnanswered: ({ method, reason }) => {
            const current = runtimes.get(sessionId);
            if (current?.runtime === undefined) return;
            void current.runtime
              .followUp(
                `此前有一次询问（${method}）${
                  reason === "timeout" ? "超时无人应答" : "没有可承载交互的控制层"
                }。不要继续等：按你的最佳判断往下做，并在结果里说明你做了哪些假设。`,
              )
              .catch(() => undefined);
          },
        }),
        onEvent: (event: SessionEvent) => bus.broadcastToSession(sessionId, event),
        onNotice: (level, message) => {
          bus.broadcastToSession(sessionId, { type: "ui.notify", level, message, sessionId });
        },
        onStatusChange: () => {
          const current = runtimes.get(sessionId);
          if (current === undefined) return;
          bus.notifyStatus(sessionId, statusOf(current), broker.pendingCount(sessionId));
        },
        pendingInteractions: () => broker.pendingCount(sessionId),
        attachments: () => bus.attachmentsFor(sessionId).length,
        onDecision: (decision) => {
          void recordDecision(sessionId, "tool.decision", decision);
        },
      },
      await repo.entries(),
    );

    const entry: RuntimeEntry = { runtime, repo };
    runtimes.set(sessionId, entry);
    return entry;
  }

  function requireAttachment(connection: ConnectionState, sessionId: string | null): string {
    if (sessionId === null) throw new ServiceError("invalid_args", "该命令需要一个 sessionId。");
    if (connection.attachmentSessionId !== sessionId) {
      throw new ServiceError("not_attached", "这条连接没有挂载到该会话。");
    }
    return sessionId;
  }

  function requireCapability(connection: ConnectionState, command: CommandName): void {
    const needed = COMMAND_CAPABILITIES[command];
    if (!connection.granted.includes(needed)) {
      throw new ServiceError(
        "unsupported_capability",
        `这条通路未被授予 ${needed} 能力（信任级别 ${connection.trustLevel}）。`,
        { needed, trustLevel: connection.trustLevel },
      );
    }
  }

  /**
   * 写入前的闸门：只读挂载（owner 在别的实例手上）一律拒绝，并把类型收窄成"一定有运行时"。
   * 这样"非 owner 不写"在类型层面就成立，而不是靠每个处理器自觉判断。
   */
  function writable(entry: RuntimeEntry): RuntimeEntry & { runtime: SessionRuntime } {
    if (entry.runtime === undefined) {
      throw new ServiceError("internal_error", "会话运行时尚未建立，拒绝写入。");
    }
    return entry as RuntimeEntry & { runtime: SessionRuntime };
  }

  function guardAutonomy(connection: ConnectionState, autonomy: AutonomyLevel): void {
    if (requiresTrustToDrive(autonomy) && !canDriveUnattended(connection.trustLevel)) {
      throw new ServiceError(
        "autonomy_denied",
        `会话自主级别为 ${autonomy}（免批准执行），只有本机等价或已认证且有授权的通路能驱动它。`,
        { autonomy, trustLevel: connection.trustLevel },
      );
    }
  }

  async function handleCommand(
    connection: ConnectionState,
    envelope: { id: string; command: CommandName; sessionId: string | null; args: unknown },
  ): Promise<Response> {
    const { id, command } = envelope;
    requireCapability(connection, command);

    switch (command) {
      case "session.create": {
        const args = commandArgs(command, envelope.args);
        const autonomy = args.autonomy ?? defaultAutonomy;
        guardAutonomy(connection, autonomy);
        const cwd = args.cwd ?? defaultCwd;

        // 临时会话（F-1.5 辅助对话）：不建文件、不进列表，仓库换成内存实现。
        if (args.ephemeral === true) {
          const ephemeralId = `eph-${randomBytes(6).toString("hex")}`;
          const entry = await openRuntime(ephemeralId, {
            repo: createEphemeralRepo({ id: ephemeralId, cwd }),
          });
          if (autonomy !== defaultAutonomy) writable(entry).runtime.setAutonomy(autonomy);
          connection.attachmentSessionId = ephemeralId;
          return okResponse(id, command, {
            sessionId: ephemeralId,
            cwd,
            autonomy,
            ephemeral: true,
          });
        }

        const repo = await store.createSession({ cwd });
        // **先挂 attachment 再建运行时**：运行时装配期会产生面向用户的提醒（例如"项目本地资源
        // 未授信，未加载"），而提醒是按 attachment 广播的——挂晚了用户就看不到。
        const previousAttachment = connection.attachmentSessionId;
        connection.attachmentSessionId = repo.id;
        let created: RuntimeEntry & { runtime: SessionRuntime };
        try {
          // **无条件建运行时**：之前只在"自主级别非默认"时才建，于是新建的会话在界面里
          // 一直显示"无模型 / 未知目录"（状态来自冷读路径），而第一次发送又要临时承担
          // 建运行时的延迟。建会话本来就是要用它，提前建没有代价。
          created = writable(await openRuntime(repo.id));
        } catch (error) {
          connection.attachmentSessionId = previousAttachment;
          throw error;
        }
        if (autonomy !== defaultAutonomy) created.runtime.setAutonomy(autonomy);
        return okResponse(id, command, { sessionId: repo.id, cwd, autonomy });
      }

      case "session.list": {
        const sessions = await store.listSessions();
        return okResponse(id, command, { sessions: sessions.map(toSummary) });
      }

      case "session.attach": {
        const sessionId = envelope.sessionId;
        if (sessionId === null) throw new ServiceError("invalid_args", "attach 需要 sessionId。");
        // 临时会话（F-1.5）不在 store 里：已在运行时表中的会话直接复用，不再查数据层。
        const known = runtimes.get(sessionId);
        const repo = known?.repo ?? (await store.openSession(sessionId));
        if (repo === undefined)
          throw new ServiceError("session_not_found", `会话不存在：${sessionId}`);
        connection.attachmentSessionId = sessionId;
        const entry = await openRuntime(sessionId);
        // 中途挂载：先给状态快照，再全量重放已落盘记录，随后增量事件自然接上（spec §4.5 第 3 条）
        const state = await stateOf(entry);
        connection.options.send({
          type: "status",
          sessionId,
          status: state.status,
          pendingInteractions: state.pendingInteractions,
          pendingMessages: state.pendingMessages,
        });
        for (const record of await entry.repo.read(0, 5_000)) {
          connection.options.send({
            type: "entry_appended",
            sessionId,
            seq: record.seq,
            entry: record.entry,
          });
        }
        return okResponse(id, command, { sessionId, replayed: true, readOnly: false });
      }

      case "session.detach": {
        const sessionId = requireAttachment(connection, envelope.sessionId);
        connection.attachmentSessionId = null;
        return okResponse(id, command, { sessionId });
      }

      case "session.get_state": {
        const sessionId = envelope.sessionId;
        if (sessionId === null)
          throw new ServiceError("invalid_args", "get_state 需要 sessionId。");
        const entry = runtimes.get(sessionId);
        if (entry !== undefined) {
          return okResponse(id, command, { state: await stateOf(entry) });
        }
        const repo = await store.openSession(sessionId);
        if (repo === undefined)
          throw new ServiceError("session_not_found", `会话不存在：${sessionId}`);
        const header = await repo.readHeader();
        const cold: SessionState = {
          sessionId,
          name: null,
          cwd: header.cwd,
          model: null,
          thinkingLevel: null,
          autonomy: defaultAutonomy,
          status: "idle",
          cursor: await repo.count(),
          pendingMessages: 0,
          pendingInteractions: 0,
          attachments: bus.attachmentsFor(sessionId).length,
          // 没建过运行时的会话：模型可用性还没被判定过。冷读不臆断，报"有"，
          // 真正需要时会由 owner 侧在发送前拒绝。
          modelAvailable: true,
        };
        return okResponse(id, command, { state: cold });
      }

      case "session.get_entries": {
        const args = commandArgs(command, envelope.args);
        const sessionId = envelope.sessionId;
        if (sessionId === null)
          throw new ServiceError("invalid_args", "get_entries 需要 sessionId。");
        const repo = runtimes.get(sessionId)?.repo ?? (await store.openSession(sessionId));
        if (repo === undefined)
          throw new ServiceError("session_not_found", `会话不存在：${sessionId}`);
        const records = await repo.read(args.fromSeq ?? 0, args.limit);
        return okResponse(id, command, {
          cursor: await repo.count(),
          records: records.map((record) => ({ seq: record.seq, entry: record.entry })),
        });
      }

      case "session.get_tree": {
        const sessionId = envelope.sessionId;
        if (sessionId === null) throw new ServiceError("invalid_args", "get_tree 需要 sessionId。");
        const repo = runtimes.get(sessionId)?.repo ?? (await store.openSession(sessionId));
        if (repo === undefined)
          throw new ServiceError("session_not_found", `会话不存在：${sessionId}`);
        return okResponse(id, command, { tree: buildTree(await repo.entries()) });
      }

      case "session.fork":
      case "session.clone": {
        const args = command === "session.fork" ? commandArgs("session.fork", envelope.args) : {};
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        const all = await entry.repo.entries();
        const fromId = "fromId" in args ? args.fromId : undefined;
        const entries = fromId === undefined || fromId === null ? all : branchPath(all, fromId);
        const created = await store.createSession({
          cwd: entry.repo.cwd,
          parentSession: entry.repo.file,
        });
        for (const record of entries) {
          await created.append(record as unknown as { type: string });
        }
        return okResponse(id, command, { sessionId: created.id, entries: entries.length });
      }

      case "session.set_name": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.setName(args.name);
        return okResponse(id, command, { sessionId, name: args.name });
      }

      case "session.edit_entry": {
        // 编辑历史（F-1.3）：追加式改写，不破坏原记录。
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.editEntry(args.entryId, args.content);
        return okResponse(id, command, {
          sessionId,
          entryId: args.entryId,
          omitted: args.content === null,
        });
      }

      case "interaction.resolve": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const resolved = await resolvePendingInteraction(
          sessionId,
          args.interactionId,
          args.value,
          args.cancelled,
          connection,
        );
        if (!resolved) {
          throw new ServiceError("invalid_args", `待决交互不存在或已解决：${args.interactionId}`);
        }
        return okResponse(id, command, { sessionId, interactionId: args.interactionId });
      }

      case "session.archive": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        const record = await entry.repo.append({
          type: "custom",
          customType: "session.archived",
          data: { archived: args.archived },
        });
        bus.broadcastToSession(sessionId, {
          type: "entry_appended",
          sessionId,
          seq: record.seq,
          entry: record.entry,
        });
        await store.listSessions().catch(() => undefined);
        return okResponse(id, command, { sessionId, archived: args.archived });
      }

      case "session.set_autonomy": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        guardAutonomy(connection, args.level);
        const entry = writable(await openRuntime(sessionId));
        entry.runtime.setAutonomy(args.level);
        await recordDecision(sessionId, "autonomy.changed", {
          level: args.level,
          by: connection.id,
          trustLevel: connection.trustLevel,
        });
        return okResponse(id, command, { sessionId, autonomy: args.level });
      }

      case "prompt": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        guardAutonomy(connection, entry.runtime.autonomy);
        // 会话正在跑：**排队进下一轮**，不是拒绝。
        // 多端共用一个会话时，"另一端正在跑"是常态而不是错误——拒绝会让用户在两个壳之间
        // 来回试；排队则让任意一端随时都能把话说完（次序由队列保证）。
        if (entry.runtime.status !== "idle") {
          await entry.runtime.followUp(args.text);
          return okResponse(id, command, {
            sessionId,
            accepted: true,
            queued: true,
            pendingMessages: entry.runtime.state().pendingMessages,
          });
        }
        // 不阻塞响应：一轮可能跑很久，事件面负责把进展发出去。
        void entry.runtime.startPrompt(args.text, args.references).catch((error: unknown) => {
          const message =
            error instanceof UnsupportedReferenceError ? error.message : String(error);
          bus.broadcastToSession(sessionId, {
            type: "ui.notify",
            level: "error",
            message: `这一轮执行失败：${message}`,
            sessionId,
          });
        });
        return okResponse(id, command, { sessionId, accepted: true, queued: false });
      }

      case "steer": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.steer(args.text);
        return okResponse(id, command, { sessionId });
      }

      case "follow_up": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.followUp(args.text);
        return okResponse(id, command, { sessionId });
      }

      case "abort": {
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.abort();
        return okResponse(id, command, { sessionId });
      }

      case "clear_queue": {
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        return okResponse(id, command, entry.runtime.clearQueue());
      }

      case "model.set": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        const changed = await entry.runtime.setModel(args.provider, args.modelId);
        if (!changed)
          throw new ServiceError("invalid_args", `模型不存在：${args.provider}/${args.modelId}`);
        return okResponse(id, command, {
          sessionId,
          model: { provider: args.provider, modelId: args.modelId },
        });
      }

      case "model.list": {
        // 用**新建**的运行时读可用模型：常驻实例的"可用性快照"由基座在后台刷新，
        // 刚启动或刚改完供应商配置时会短暂为空——控制层的模型选择器会因此看起来
        // "没有模型可用"（实测踩到）。`provider.list` 早就是每次新建，这里与它对齐。
        const models = await listModels(await createModelRuntime(store.paths));
        return okResponse(id, command, { models });
      }

      // 供应商配置（F-5.3）：控制层的"模型配置窗口"经此写入数据层。
      case "provider.list": {
        return okResponse(id, command, await listProviderSummaries(store.paths.root));
      }

      case "provider.add": {
        const args = commandArgs(command, envelope.args);
        const outcome = await addProviderConfig(store.paths.root, {
          id: args.id,
          baseUrl: args.baseUrl,
          ...(args.api === undefined ? {} : { api: args.api }),
          ...(args.apiKey === undefined ? {} : { apiKey: args.apiKey }),
          models: args.models,
          ...(args.makeDefault === undefined ? {} : { makeDefault: args.makeDefault }),
        });
        // 新供应商要立刻可用：重建运行时，否则本次连接后续的 model.list 仍是旧目录。
        modelRuntime = await createModelRuntime(store.paths);
        return okResponse(id, command, outcome);
      }

      case "provider.remove": {
        const args = commandArgs(command, envelope.args);
        const removed = await deleteProviderConfig(store.paths.root, args.id);
        modelRuntime = await createModelRuntime(store.paths);
        return okResponse(id, command, { removed });
      }

      case "thinking.set": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.setThinkingLevel(args.level);
        return okResponse(id, command, { sessionId, level: args.level });
      }

      case "compact": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        await entry.runtime.compact(args.instructions);
        return okResponse(id, command, { sessionId });
      }

      case "bash": {
        const args = commandArgs(command, envelope.args);
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        const result = (await entry.runtime.session.executeBash(args.command)) as unknown as {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          code?: number;
        };
        await recordDecision(sessionId, "bash.direct", {
          command: args.command,
          by: connection.id,
        });
        return okResponse(id, command, {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? result.code ?? 0,
        });
      }

      case "bash.abort": {
        const sessionId = requireAttachment(connection, envelope.sessionId);
        const entry = writable(await openRuntime(sessionId));
        entry.runtime.session.abortBash();
        return okResponse(id, command, { sessionId });
      }

      case "task.list": {
        return okResponse(id, command, {
          tasks: scheduler.list(),
          keepAwake: scheduler.keepAwake,
        });
      }

      case "task.create": {
        const args = commandArgs(command, envelope.args);
        // 越权任务必须显式声明自主级别，且要过信任矩阵（未认证通路不能建自动执行的任务）。
        if (args.autonomy !== undefined) guardAutonomy(connection, args.autonomy);
        const task = await scheduler.create({
          kind: args.kind,
          prompt: args.prompt,
          sessionId: args.sessionId ?? null,
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.cron === undefined ? {} : { cron: args.cron }),
          ...(args.delayMinutes === undefined ? {} : { delayMinutes: args.delayMinutes }),
          ...(args.everyMinutes === undefined ? {} : { everyMinutes: args.everyMinutes }),
          ...(args.autonomy === undefined ? {} : { autonomy: args.autonomy }),
        });
        return okResponse(id, command, { task });
      }

      case "task.cancel": {
        const { taskId } = commandArgs(command, envelope.args);
        const removed = await scheduler.cancel(taskId);
        if (!removed) throw new ServiceError("invalid_args", `任务不存在：${taskId}`);
        return okResponse(id, command, { taskId });
      }

      case "task.pause": {
        const { taskId } = commandArgs(command, envelope.args);
        if (!(await scheduler.pause(taskId)))
          throw new ServiceError("invalid_args", `任务不存在：${taskId}`);
        return okResponse(id, command, { taskId, status: "paused" });
      }

      case "task.resume": {
        const { taskId } = commandArgs(command, envelope.args);
        if (!(await scheduler.resume(taskId)))
          throw new ServiceError("invalid_args", `任务不存在：${taskId}`);
        return okResponse(id, command, { taskId, status: "active" });
      }

      case "task.run": {
        const { taskId } = commandArgs(command, envelope.args);
        const run = await scheduler.runNow(taskId);
        if (run === null) throw new ServiceError("invalid_args", `任务不存在：${taskId}`);
        return okResponse(id, command, { taskId, run });
      }

      case "stats.usage": {
        // F-5.6：从会话记录本地聚合，不另建统计表（避免出现两份对不上的数据）。
        const summary = await collectUsageStats(store.paths.root);
        const result: UsageStatsResult = { summary, readable: summarizeUsage(summary) };
        return okResponse(id, command, result);
      }

      case "support.export": {
        // F-5.7：导出前脱敏——这是要发出去的东西。
        const args = commandArgs(command, envelope.args);
        const bundle = await exportSupportBundle({
          dataDir: store.paths.root,
          ...(args.maxLogFiles === undefined ? {} : { maxLogFiles: args.maxLogFiles }),
        });
        return okResponse(id, command, {
          file: bundle.file,
          bytes: bundle.bytes,
          included: bundle.included,
        });
      }

      case "migration.preflight": {
        // F-5.8：只读预检，不写任何东西。
        const { from } = commandArgs(command, envelope.args);
        const report = await preflightMigration({ from, to: store.paths.root });
        return okResponse(id, command, { report });
      }

      case "migration.import": {
        const args = commandArgs(command, envelope.args);
        const result = await applyMigration({
          from: args.from,
          to: store.paths.root,
          ...(args.onConflict === undefined ? {} : { onConflict: args.onConflict }),
        });
        await store.rebuildIndex().catch(() => undefined);
        return okResponse(id, command, {
          copied: result.copied.length,
          skipped: result.skipped.length,
        });
      }

      case "marketplace.overview": {
        // F-3.6：源（用户登记的）与已装资源（数据层里现在有什么）一起给，面板一次渲染完。
        const [sources, installed] = await Promise.all([
          listSources(store.paths.root),
          listInstalled(store.paths.root),
        ]);
        return okResponse(id, command, {
          sources,
          installed: installed.map((resource) => ({
            kind: resource.kind,
            name: resource.name,
            path: resource.path,
          })),
        });
      }

      case "marketplace.catalog": {
        const { source: sourceName } = commandArgs(command, envelope.args);
        const source = await findSource(store.paths.root, sourceName);
        if (source === undefined) {
          throw new ServiceError("invalid_args", `没有名为 ${sourceName} 的市场源。`);
        }
        return okResponse(id, command, { entries: await readCatalog(source) });
      }

      case "marketplace.add_source": {
        const args = commandArgs(command, envelope.args);
        const source = await addSource(store.paths.root, {
          name: args.name,
          kind: args.kind,
          location: args.location,
          ...(args.description === undefined ? {} : { description: args.description }),
        });
        return okResponse(id, command, { source });
      }

      case "marketplace.remove_source": {
        const { name } = commandArgs(command, envelope.args);
        if (!(await removeSource(store.paths.root, name))) {
          throw new ServiceError("invalid_args", `没有名为 ${name} 的市场源。`);
        }
        return okResponse(id, command, { name });
      }

      case "marketplace.install": {
        const args = commandArgs(command, envelope.args);
        const source = await findSource(store.paths.root, args.source);
        if (source === undefined) {
          throw new ServiceError("invalid_args", `没有名为 ${args.source} 的市场源。`);
        }
        const entry = (await readCatalog(source)).find((item) => item.name === args.plugin);
        if (entry === undefined) {
          throw new ServiceError("invalid_args", `源 ${args.source} 里没有插件 ${args.plugin}。`);
        }
        const report = await installPlugin({
          dataDir: store.paths.root,
          source,
          entry,
          ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        });
        return okResponse(id, command, { report, readable: summarizeInstall(report) });
      }

      case "marketplace.uninstall": {
        const args = commandArgs(command, envelope.args);
        const result = await uninstallPlugin({
          dataDir: store.paths.root,
          kind: args.kind,
          name: args.name,
        });
        return okResponse(id, command, result);
      }
    }
  }

  async function handleChannelMessage(
    connection: ConnectionState,
    message: ClientMessage,
  ): Promise<void> {
    if (message.type === "channel.open") {
      if (message.channel === "pty") {
        const params = (message.params ?? {}) as { cols?: number; rows?: number; cwd?: string };
        try {
          const channelId = message.channelId;
          const channel = openPtyChannel(
            channelId,
            {
              ...(params.cols === undefined ? {} : { cols: params.cols }),
              ...(params.rows === undefined ? {} : { rows: params.rows }),
              cwd: params.cwd ?? defaultCwd,
            },
            connection.trustLevel,
            (out) => connection.options.send(out),
            (id) => ptyChannels.delete(id),
          );
          ptyChannels.set(channelId, { channel, connectionId: connection.id });
          channel.onData((out) => connection.options.send(out));
          connection.options.send({
            type: "channel.opened",
            channelId,
            channel: "pty",
            params: { cols: params.cols ?? 80, rows: params.rows ?? 24 },
          });
        } catch (error) {
          connection.options.send({
            type: "channel.closed",
            channelId: message.channelId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      const sessionId = connection.attachmentSessionId;
      if (sessionId === null) {
        connection.options.send({
          type: "channel.closed",
          channelId: message.channelId,
          reason: "not_attached：先挂载一个会话。",
        });
        return;
      }
      const repo = await store.openSession(sessionId);
      connection.options.send({
        type: "channel.opened",
        channelId: message.channelId,
        channel: "workspace",
        params: { cwd: repo?.cwd ?? defaultCwd },
      });
      return;
    }

    if (message.type === "channel.close") {
      ptyChannels.get(message.channelId)?.channel.close();
      ptyChannels.delete(message.channelId);
      return;
    }

    if (message.type === "channel.data") {
      ptyChannels.get(message.channelId)?.channel.write(message.data);
      return;
    }

    if (message.type === "channel.resize") {
      ptyChannels.get(message.channelId)?.channel.resize(message.cols, message.rows);
      return;
    }

    if (message.type === "channel.signal") {
      ptyChannels.get(message.channelId)?.channel.signal(message.signal);
      return;
    }

    if (message.type === "channel.request") {
      const sessionId = connection.attachmentSessionId;
      const repo = sessionId === null ? undefined : await store.openSession(sessionId);
      const cwd = repo?.cwd ?? defaultCwd;
      try {
        const params = (message.params ?? {}) as Record<string, unknown>;
        let data: unknown;
        switch (message.method) {
          case "tree":
            data = await workspaceTree(
              cwd,
              params as { path?: string; depth?: number; filter?: string },
            );
            break;
          case "git.log":
            data = await gitLog(cwd, params as { limit?: number; skip?: number });
            break;
          case "git.changes":
            data = await gitChanges(cwd);
            break;
          case "read":
            data = await workspaceRead(cwd, params as { path: string; maxBytes?: number });
            break;
          default:
            throw new ServiceError("invalid_args", `未知的工作区查询方法：${message.method}`);
        }
        connection.options.send({
          type: "channel.response",
          id: message.id,
          channelId: message.channelId,
          success: true,
          data,
        });
      } catch (error) {
        connection.options.send({
          type: "channel.response",
          id: message.id,
          channelId: message.channelId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
  }

  /**
   * 任务触发时驱动 agent（F-4.1~4.3）：绑定了会话就投递到该会话，否则新建一个。
   *
   * 安全：任务声明的自主级别在**创建时**已经过 `guardAutonomy`（未认证通路不能建越权任务），
   * 因此这里可以放心地按任务的级别驱动；非 owner 时明确失败而不是假装跑了。
   */
  async function runAutomationTask(task: AutomationTask): Promise<TaskRunOutcome> {
    let sessionId = task.sessionId;
    if (sessionId === null || (await store.openSession(sessionId)) === undefined) {
      const repo = await store.createSession({ cwd: task.cwd });
      sessionId = repo.id;
    }
    const entry = await openRuntime(sessionId);
    if (entry.runtime === undefined) {
      return { sessionId, status: "failed", note: "会话运行时未能建立，无法驱动。" };
    }
    if (task.autonomy !== undefined) entry.runtime.setAutonomy(task.autonomy);
    await entry.runtime.startPrompt(task.prompt);
    return { sessionId, status: "completed" };
  }

  const scheduler = new TaskScheduler({
    dataDir: store.paths.root,
    runner: runAutomationTask,
    // 闲时任务让路判据：有会话在跑或等待交互，就算"宿主忙"。
    isBusy: () =>
      [...runtimes.values()].some((entry) => {
        const status = entry.runtime?.status;
        return status === "running" || status === "waiting" || status === "compacting";
      }),
  });

  const core: Service = {
    coreId,
    dataDir: store.paths.root,
    store,

    capabilities: () => coreCapabilities(),

    attachConnection(options: AttachConnectionOptions): ConnectionHandle {
      const id = `conn-${randomBytes(4).toString("hex")}`;
      const connection: ConnectionState = {
        id,
        options,
        hello: null,
        trustLevel: options.trustLevel,
        granted: [],
        attachmentSessionId: null,
      };
      connections.set(id, connection);

      return {
        id,
        trustLevel: options.trustLevel,
        get grantedCapabilities(): Capability[] {
          return connection.granted;
        },
        async receive(raw: unknown): Promise<void> {
          const parsedMessage = parseClientMessage(raw);
          if (!parsedMessage.ok) {
            options.send(
              parseErrorResponse(parsedMessage.error.message, parsedMessage.error.issues),
            );
            return;
          }
          const message: ClientMessage = parsedMessage.value;

          if (message.type === "hello") {
            const result = await handleHello({
              hello: message,
              coreId,
              trustLevel: options.trustLevel,
              coreCapabilities: coreCapabilities(),
              store,
            });
            if (!result.ok) {
              options.send(result.rejected);
              return;
            }
            connection.hello = message;
            connection.granted = result.welcome.grantedCapabilities;
            // 断线续传：客户端带了 resume 时，先按游标把缺口补上（显式信号在 resumeAck 里）。
            if (message.resume !== null) {
              const repo = await store.openSession(message.resume.sessionId);
              if (repo !== undefined) {
                connection.attachmentSessionId = message.resume.sessionId;
                const missing = await repo.read(message.resume.fromSeq, 2_000);
                options.send({
                  ...result.welcome,
                  resumeAck: {
                    sessionId: message.resume.sessionId,
                    fromSeq: message.resume.fromSeq,
                    valid: true,
                    cursor: await repo.count(),
                  },
                });
                for (const record of missing) {
                  options.send({
                    type: "entry_appended",
                    sessionId: message.resume.sessionId,
                    seq: record.seq,
                    entry: record.entry,
                  });
                }
                return;
              }
            }
            options.send(result.welcome);
            return;
          }

          if (message.type === "ui.response") {
            const outcome = broker.handleResponse(id, message as UiResponse);
            if (outcome !== undefined) {
              for (const sessionId of runtimes.keys()) {
                bus.notifyStatus(
                  sessionId,
                  statusOf(runtimes.get(sessionId) as RuntimeEntry),
                  broker.pendingCount(sessionId),
                );
              }
            }
            return;
          }

          if (message.type === "command") {
            const parsed = parseCommand(message);
            if (!parsed.ok) {
              options.send(
                errorResponse(
                  parsed.id,
                  parsed.command ?? "parse",
                  parsed.stage === "envelope"
                    ? "parse_error"
                    : parsed.stage === "unknown_command"
                      ? "unknown_command"
                      : "invalid_args",
                  parsed.message,
                  parsed.issues,
                ),
              );
              return;
            }
            try {
              const response = await handleCommand(connection, parsed);
              options.send(response);
            } catch (error) {
              if (error instanceof ServiceError) {
                options.send(
                  errorResponse(
                    parsed.id,
                    parsed.command,
                    error.code,
                    error.message,
                    error.details,
                  ),
                );
              } else {
                options.send(
                  errorResponse(
                    parsed.id,
                    parsed.command,
                    "internal_error",
                    error instanceof Error ? error.message : String(error),
                  ),
                );
              }
            }
            return;
          }

          await handleChannelMessage(connection, message);
        },

        async close(): Promise<void> {
          connections.delete(id);
          broker.withdrawForConnection(id);
          for (const [channelId, entry] of ptyChannels) {
            if (entry.connectionId === id) {
              entry.channel.close();
              ptyChannels.delete(channelId);
            }
          }
        },
      };
    },

    tasks: scheduler,

    async close(): Promise<void> {
      await scheduler.stop();
      for (const { channel } of ptyChannels.values()) channel.close();
      ptyChannels.clear();
      for (const entry of runtimes.values()) {
        await entry.runtime?.dispose().catch(() => undefined);
      }
      runtimes.clear();
      connections.clear();
      await store.close();
    },
  };

  await scheduler.start();
  return core;
}

/** 由 parentId 构成树（分支不复制历史）。 */
export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
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

/** 从根到某条记录的路径（分叉用：指向更早记录的新子节点，不需要复制历史）。 */
export function branchPath(entries: SessionEntry[], targetId: string): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current = byId.get(targetId);
  while (current !== undefined) {
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  if (path.length === 0) throw new ServiceError("invalid_args", `找不到记录：${targetId}`);
  return path;
}

export { canRespondToInteraction };
