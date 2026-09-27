import type { SessionEntry, SessionHeader } from "./entries.ts";

/**
 * 会话存储的实现契约。
 *
 * 会话正文是 **pi 兼容格式的 JSONL**（追加式、游标 = 行号、带父指针的树）——服务写它，
 * 因为它要保证"先落盘再广播"；索引与元数据在 SQLite（见 session-index.ts）。
 */

/** 索引里的会话条目：派生数据，随时可丢、可重建（真相永远是扫描会话目录本身）。 */
export type IndexedSession = {
  id: string;
  cwd: string;
  name: string | null;
  /** 会话文件里 header 的时间戳。 */
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  firstMessage: string | null;
  /** 手动归档、不自动删除。 */
  archived: boolean;
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
  /** 是否检测到整体替换（不能只靠 inode：迁移是原地重写，inode 不变）。 */
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
