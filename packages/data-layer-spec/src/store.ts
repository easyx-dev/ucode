import type { SessionEntry, SessionHeader } from "./entries.ts";
import type { DataLayerVersion } from "./version.ts";

/**
 * 协议 D 的**实现契约**（spec §7.3）。
 *
 * 任何语言、任何实现都可以满足这个接口；`createConformanceSuite` 接收一个工厂函数，
 * 因此"数据层可被独立实现"不是一句口号：换实现 = 换工厂，套件不动、用例不动。
 */

export type StorePaths = {
  dataDir: string;
  versionFile: string;
  settings: string;
  models: string;
  auth: string;
  sessions: string;
  cache: string;
  locks: string;
  logs: string;
  extensions: string;
  skills: string;
  prompts: string;
  themes: string;
};

/** 索引里的会话条目：派生数据，随时可丢、可重建（真相永远是扫描数据层本身）。 */
export type IndexedSession = {
  id: string;
  cwd: string;
  file: string;
  name: string | null;
  /** 会话文件里 header 的时间戳。 */
  createdAt: string;
  /** 文件 mtime（派生数据的近似值，不参与真相判断）。 */
  updatedAt: string;
  entryCount: number;
  firstMessage: string | null;
  /** 是否被某个实例持有（读锁文件 + 校核心跳）。 */
  owned: boolean;
};

export type SessionRecord = {
  /** 游标 = 记录在文件中的行序号（header 为第 0 行）。 */
  seq: number;
  entry: SessionEntry;
};

export type AppendInput = {
  type: string;
  /** 省略时接到当前叶子之后（带父指针的树，分支不需要复制历史）。 */
  parentId?: string | null;
  [key: string]: unknown;
};

export type TailRepair = {
  /** 被截断的字节数（0 表示没有损坏尾部）。 */
  truncatedBytes: number;
  cursor: number;
};

export type RewriteDetection = {
  /**
   * 是否检测到整体替换。
   * **不能只靠 inode 变化**：格式迁移是原地重写（inode 不变，V-5 已推翻原假设）。
   */
  rewritten: boolean;
  cursor: number;
};

/** 单个会话的读写句柄。 */
export type SessionRepo = {
  readonly id: string;
  readonly cwd: string;
  readonly file: string;
  readonly createdAt: Date;
  readHeader(): Promise<SessionHeader>;
  /** 从 fromSeq 之后（不含）开始读；游标语义见 SessionRecord.seq。 */
  read(fromSeq?: number, limit?: number): Promise<SessionRecord[]>;
  entries(): Promise<SessionEntry[]>;
  count(): Promise<number>;
  append(input: AppendInput): Promise<SessionRecord>;
  /** 处置崩溃留下的不完整尾部（截断到最后一个换行处——唯一允许的原地写）。 */
  repairTail(): Promise<TailRepair>;
  detectRewrite(): Promise<RewriteDetection>;
};

/** owner 租约：一个会话同时只有一个 writer（spec §3.5）。 */
export type OwnerLease = {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  isHeld(): boolean;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
};

export type Store = {
  readonly dataDir: string;
  readonly version: DataLayerVersion;
  readonly paths: StorePaths;
  readonly ownerId: string;
  createSession(options: {
    cwd: string;
    id?: string;
    createdAt?: Date;
    /** 分叉/克隆：新会话的 header 记录它是从哪条会话分出来的。 */
    parentSession?: string;
  }): Promise<SessionRepo>;
  /** 按 id 打开；找不到返回 undefined（不抛错——列表与打开是两条不同的路径）。 */
  openSession(id: string, options?: { cwd?: string }): Promise<SessionRepo | undefined>;
  listSessions(options?: { cwd?: string }): Promise<IndexedSession[]>;
  /**
   * 竞争 owner。已被他人持有时返回 undefined；持有者心跳超时则抢占（并处置其尾部）。
   */
  acquireOwner(sessionId: string, options?: { ttlMs?: number }): Promise<OwnerLease | undefined>;
  isOwner(sessionId: string): Promise<boolean>;
  /** 全量重建派生数据（忽略现有索引）。 */
  rebuildIndex(): Promise<IndexedSession[]>;
  /** 启动时对账：索引缺失或损坏则重建；返回是否重建过。 */
  reconcileIndex(): Promise<{ rebuilt: boolean; sessions: IndexedSession[] }>;
  /** 非追加写必须原子（临时文件 → fsync → rename）。相对数据层根目录。 */
  writeAtomic(relativePath: string, contents: string, options?: { mode?: number }): Promise<void>;
  close(): Promise<void>;
};

export type StoreGuards = {
  /** 权限校验：默认开启。拒绝启动而不是静默修正权限。 */
  requirePermissions?: boolean;
  /** 危险文件系统探测：默认查已知云同步目录 + statfs 文件系统类型。 */
  dangerousFileSystem?: (
    dataDir: string,
  ) => { dangerous: boolean; reason?: string } | Promise<{ dangerous: boolean; reason?: string }>;
};

export type StoreOptions = {
  dataDir: string;
  /** 本实例标识（owner 竞争用）。省略则自动生成。 */
  ownerId?: string;
  now?: () => Date;
  guards?: StoreGuards;
  locks?: { globalLockTimeoutMs?: number };
};

export type StoreFactory = (options: StoreOptions) => Promise<Store>;
