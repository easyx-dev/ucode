import {
  type AppendInput,
  CURRENT_SESSION_VERSION,
  type RewriteDetection,
  type SessionEntry,
  type SessionHeader,
  type SessionRecord,
  type SessionRepo,
  type TailRepair,
} from "../storage/index.ts";
/**
 * 临时会话的内存仓库（F-1.5 辅助对话）。
 *
 * 辅助对话（side chat）的语义是"临时会话、不持久、不进列表"。做到这一点最干净的方式
 * 不是"标记一下然后到处过滤"，而是**换掉仓库**：`store` 仍然是权威，只是这个仓库不落盘。
 * 于是：
 * - 记录只存在于内存（重启即消失，符合"临时"）；
 * - `store.listSessions` 看不到它（没有文件），因此无需在列表处加过滤条件；
 * - 会话运行时的其余逻辑（先落盘再广播、游标=行号）**完全不变**——广播照旧，只是"盘"在内存里。
 */
export function createEphemeralRepo(options: {
  id: string;
  cwd: string;
  now?: () => Date;
}): SessionRepo {
  const now = options.now ?? (() => new Date());
  const createdAt = now();
  const entries: SessionEntry[] = [];

  const header = (): SessionHeader => ({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: options.id,
    timestamp: createdAt.toISOString(),
    cwd: options.cwd,
  });

  return {
    id: options.id,
    cwd: options.cwd,
    // 没有落盘文件：用一个显式的伪路径，便于诊断时一眼看出"这是临时会话"。
    file: `<ephemeral:${options.id}>`,
    createdAt,
    async readHeader() {
      return header();
    },
    async read(fromSeq = 0, limit) {
      const start = Math.max(0, fromSeq);
      const records: SessionRecord[] = entries
        .slice(start)
        .map((entry, index) => ({ seq: start + index + 1, entry }));
      return limit === undefined ? records : records.slice(0, limit);
    },
    async entries() {
      return [...entries];
    },
    async count() {
      return entries.length;
    },
    async append(input: AppendInput) {
      entries.push(input as unknown as SessionEntry);
      return { seq: entries.length, entry: entries[entries.length - 1] as SessionEntry };
    },
    async repairTail(): Promise<TailRepair> {
      return { truncatedBytes: 0, cursor: entries.length };
    },
    async detectRewrite(): Promise<RewriteDetection> {
      return { rewritten: false, cursor: entries.length };
    },
  };
}
