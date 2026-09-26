import { watch } from "node:fs";
import type { SessionRecord, SessionRepo } from "@ucode/data-layer-spec";

/**
 * 跟随：非 owner 实例靠"监听文件变更 + 按位置跟随"获得实时进展（spec §3.7 / ADR-008）。
 *
 * 为什么不用实例间通道：那需要服务发现、连接、认证、双向协议、断线重连、去重一整套机制，
 * 而这些机制只为让非 owner 看到进展——数据层文件天然是广播介质（owner 本来就要写它）。
 *
 * 三个必须处理的坑（spec §3.12、V-10 已验证）：
 * 1. **`fs.watch` 会合并/丢事件**——通知只做主路径，必须**轮询兜底**（最终一致靠轮询）；
 * 2. **只解析到最后一个完整换行**，余下留缓冲（由 SessionRepo.read 保证）；
 * 3. **不能只靠 inode 变化**检测整体替换：格式迁移是**原地重写**（inode 不变，V-5 已推翻原假设）。
 *
 * 判据因此不用字节，而用**语义**：跟随者真正依赖的是"seq → 记录"的对应关系。
 * - 每个已确认的 seq 仍是同一条记录（id 相同）→ 一切正常，只上报新增；
 * - 某个已知 seq 变成了另一条记录（或记录数变少）→ 游标不可信，发显式重同步信号。
 *
 * 这也天然免疫"写到一半被读到"的中间态：中间态要么少几条（→ 重同步，下一拍恢复正常），
 * 要么多一条残行（解析器本就只认完整行）。
 */

export type FollowHandlers = {
  /** 新增记录（按 seq 升序，保证顺序）。 */
  onEntries(records: SessionRecord[]): void;
  /**
   * seq→记录 的对应关系已改变：游标不可信，控制层必须重新全量同步（spec §4.5 的显式信号）。
   * reason 只是诊断信息（`truncated_tail`：崩溃尾部被处置；`migration`：格式迁移原地重写）。
   */
  onResync(cursor: number, reason: "migration" | "truncated_tail"): void;
};

export type FollowOptions = {
  /** 轮询间隔（毫秒）。通知是主路径，因此这个间隔可以稀疏。 */
  pollIntervalMs?: number;
  /** 停止跟随。 */
  signal?: AbortSignal;
};

export type Follower = {
  /** 当前已跟到的游标。 */
  cursor(): number;
  stop(): void;
};

const DEFAULT_POLL_MS = 400;

export async function followSession(
  repo: SessionRepo,
  handlers: FollowHandlers,
  options: FollowOptions = {},
): Promise<Follower> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  let cursor = await repo.count();
  /** 已确认的 seq→id 映射（下标 = seq-1）。跟随者靠它发现"同一位子上换了别的记录"。 */
  let knownIds: string[] = [];
  let stopped = false;
  let running = false;
  let watcher: { close(): void } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const read = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const records = await repo.read(0);
      if (records.length < knownIds.length) {
        // 记录变少：seq→记录 的映射已经变了，游标不可信
        const survived = knownIds
          .slice(0, records.length)
          .every((id, index) => records[index]?.entry.id === id);
        cursor = records.length;
        knownIds = records.map((record) => record.entry.id);
        handlers.onResync(cursor, survived ? "truncated_tail" : "migration");
        return;
      }
      for (let index = 0; index < knownIds.length; index += 1) {
        const current = records[index]?.entry.id;
        if (current !== knownIds[index]) {
          // 已知位子上换了别的记录：格式迁移原地重写（inode 不变也查得出来）
          cursor = knownIds.length;
          handlers.onResync(cursor, "migration");
          return;
        }
      }

      const fresh = records.slice(cursor);
      if (fresh.length === 0) return;
      const last = fresh.at(-1);
      if (last !== undefined) cursor = last.seq;
      knownIds = records.map((record) => record.entry.id);
      handlers.onEntries(fresh);
    } catch {
      // 竞态（文件正被写入、目录被替换）不该中断跟随：下一次触发或轮询再读
    } finally {
      running = false;
    }
  };

  const scheduleWatch = (): void => {
    try {
      // 通知只是主路径（会漏事件），失败就完全靠轮询——最终一致由轮询保证。
      const handle = watch(repo.file, () => {
        void read();
      });
      handle.on("error", () => {
        watcher?.close();
        watcher = undefined;
      });
      watcher = handle;
    } catch {
      watcher = undefined;
    }
  };
  scheduleWatch();

  timer = setInterval(() => {
    void read();
  }, pollIntervalMs);
  timer.unref?.();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    watcher?.close();
    watcher = undefined;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  options.signal?.addEventListener("abort", stop, { once: true });

  // 基线：跟随的语义是"从现在起"，挂载时的存量由 session.attach 的重放负责。
  knownIds = (await repo.read(0)).map((record) => record.entry.id);

  return { cursor: () => cursor, stop };
}
