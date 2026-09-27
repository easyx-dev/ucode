import type {
  AutonomyLevel,
  BindingConnection,
  Capability,
  ClientKind,
  CoreServer,
  Identity,
  ServerMessage,
  SessionStatus,
  TrustLevel,
} from "@ucode/protocol";
import type { TaskScheduler } from "./modules/tasks/scheduler.ts";
import type { ServiceStore } from "./storage/index.ts";

/**
 * 服务层的对外契约（传输无关）。
 *
 * 绑定层只做三件事：序列化、寻址、流式（spec §5.1）。因此这里出现的每个方法
 * 都不含任何传输细节——绑定把消息解出来交给 `receive`，把核心给的消息写回连接。
 */

/** 服务层看到的"一条 attachment"= 一条控制层连接挂到某个会话上的挂载记录。 */
export type AttachmentView = {
  connectionId: string;
  sessionId: string;
  capabilities: Capability[];
  trustLevel: TrustLevel;
  clientKind: ClientKind;
  identity: Identity;
};

/** 服务层向控制层发消息的唯一出口。绑定实现它，核心不关心背后是什么传输。 */
export type ServiceBus = {
  attachmentsFor(sessionId: string): AttachmentView[];
  sendTo(connectionId: string, message: ServerMessage): void;
  broadcastToSession(sessionId: string, message: ServerMessage): void;
  /** 会话状态变化（忙闲、待决交互数）时通知所有挂载者。 */
  notifyStatus(sessionId: string, status: SessionStatus, pendingInteractions: number): void;
};

export type ConnectionHandle = BindingConnection;

export type AttachConnectionOptions = {
  /** 绑定名，仅用于诊断（stdio / unix / http / ws）。 */
  binding: string;
  /**
   * **信任级别由绑定声明，不由客户端自报**（ADR-004）。
   * 绑定知道自己的来历（父进程 spawn / 环回 / 非环回未认证），服务层只查表。
   */
  trustLevel: TrustLevel;
  /** 这条通路上是否可能出现别的用户（用于日志与诊断）。 */
  send: (message: ServerMessage) => void;
};

export type ServiceConfig = {
  /** 数据层目录。 */
  dataDir: string;
  /** 默认工作目录（会话未指定 cwd 时的落点）。 */
  cwd?: string;
  /** 本实例标识（owner 竞争用）。 */
  coreId?: string;
  /** 默认自主级别（新建会话时）。 */
  defaultAutonomy?: AutonomyLevel;
  /** 交互请求的默认超时（毫秒）；0 表示不超时。 */
  interactionTimeoutMs?: number;
  /** 注入点：测试用假模型供应商、以及测试替换数据层。 */
  overrides?: {
    store?: ServiceStore;
    /** 额外的模型供应商配置（开发/测试注入假供应商用）。 */
    extraModels?: Record<string, unknown>;
  };
};

export type Service = CoreServer & {
  readonly dataDir: string;
  readonly store: ServiceStore;
  /** 服务层自身的能力全集（welcome 里回告）。 */
  capabilities(): Capability[];
  /** 自动化任务调度器（F-4.1~4.4）。 */
  readonly tasks: TaskScheduler;
  /** 关闭：释放 owner 租约、dispose 所有会话运行时。 */
  close(): Promise<void>;
};

export type SessionRuntimeEvents = {
  onEvent(sessionId: string, message: ServerMessage): void;
  onStatus(sessionId: string, status: SessionStatus, pendingInteractions: number): void;
};
