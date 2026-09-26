import { open as openFile, readFile, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { DataLayerError, type OwnerLease, type StorePaths } from "@ucode/data-layer-spec";
import { writeFileAtomic } from "./atomic.ts";

/**
 * owner 语义（spec §3.5、§3.12）。
 *
 * **一个会话同时只有一个 writer。** owner 通过竞争产生，不由配置指定：
 * 目录锁 + 心跳 mtime；抢占流程是"取全局锁 → 校核心跳超时 → 处置尾部 → 取得 owner"；
 * 优雅退出主动释放，异常退出靠心跳超时兜底。
 */

type OwnerRecord = {
  sessionId: string;
  ownerId: string;
  pid: number;
  host: string;
  acquiredAt: number;
  heartbeatAt: number;
  ttlMs: number;
};

/** 全局锁被视为陈旧的时间（持锁进程崩溃时靠它兜底）。 */
const GLOBAL_LOCK_STALE_MS = 10_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function ownerFilePath(paths: StorePaths, sessionId: string): string {
  return join(paths.locks, `${sessionId}.owner`);
}

async function readOwnerRecord(file: string): Promise<OwnerRecord | undefined> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as OwnerRecord;
    return typeof raw.ownerId === "string" && typeof raw.heartbeatAt === "number" ? raw : undefined;
  } catch {
    return undefined; // 不存在或损坏都视为"没有活着的 owner"
  }
}

/** 全局锁：让"读心跳 → 判定死亡 → 抢占"这一段成为临界区。 */
async function acquireGlobalLock(
  paths: StorePaths,
  timeoutMs: number,
): Promise<() => Promise<void>> {
  const file = join(paths.locks, "global.lock");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await openFile(file, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
      } finally {
        await handle.close();
      }
      return async () => {
        await unlink(file).catch(() => undefined);
      };
    } catch {
      const info = await stat(file).catch(() => undefined);
      if (info !== undefined && Date.now() - info.mtimeMs > GLOBAL_LOCK_STALE_MS) {
        await unlink(file).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        throw new DataLayerError("owner_conflict", "等待数据层全局锁超时");
      }
      await sleep(15);
    }
  }
}

export type AcquireOwnerOptions = {
  paths: StorePaths;
  sessionId: string;
  ownerId: string;
  ttlMs?: number;
  globalLockTimeoutMs?: number;
  now?: () => Date;
  /** 抢占时处置前任留下的损坏尾部（spec §3.12 的抢占流程第三步）。 */
  repairTail?: () => Promise<{ truncatedBytes: number; cursor: number }>;
};

export async function acquireOwner(options: AcquireOwnerOptions): Promise<OwnerLease | undefined> {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? ((): Date => new Date());
  const file = ownerFilePath(options.paths, options.sessionId);
  const releaseLock = await acquireGlobalLock(options.paths, options.globalLockTimeoutMs ?? 5_000);

  try {
    const existing = await readOwnerRecord(file);
    if (existing !== undefined && Date.now() - existing.heartbeatAt < existing.ttlMs) {
      return undefined; // 有人活着持有它
    }
    if (existing !== undefined) {
      // 前任心跳超时：先处置它可能留下的损坏尾部，再接管
      await options.repairTail?.();
    }

    const acquiredAt = now().getTime();
    const record: OwnerRecord = {
      sessionId: options.sessionId,
      ownerId: options.ownerId,
      pid: process.pid,
      host: hostname(),
      acquiredAt,
      heartbeatAt: acquiredAt,
      ttlMs,
    };
    await writeFileAtomic(file, JSON.stringify(record), { mode: 0o600 });
    return makeLease({ file, record, ttlMs, ownerId: options.ownerId });
  } finally {
    await releaseLock();
  }
}

function makeLease(params: {
  file: string;
  record: OwnerRecord;
  ttlMs: number;
  ownerId: string;
}): OwnerLease {
  const { file, record, ttlMs, ownerId } = params;
  let held = true;
  let heartbeatAt = record.heartbeatAt;

  const lease: OwnerLease = {
    sessionId: record.sessionId,
    ownerId,
    get acquiredAt() {
      return record.acquiredAt;
    },
    get expiresAt() {
      return heartbeatAt + ttlMs;
    },
    isHeld: () => held && Date.now() - heartbeatAt < ttlMs,
    heartbeat: async () => {
      if (!held) {
        throw new DataLayerError("owner_not_held", "租约已失效，不能续心跳");
      }
      const current = await readOwnerRecord(file);
      if (current === undefined || current.ownerId !== ownerId) {
        held = false;
        throw new DataLayerError("owner_not_held", "owner 已被其他实例抢占");
      }
      heartbeatAt = Date.now();
      await writeFileAtomic(file, JSON.stringify({ ...current, heartbeatAt, ttlMs }), {
        mode: 0o600,
      });
    },
    release: async () => {
      if (!held) return;
      held = false;
      const current = await readOwnerRecord(file);
      if (current !== undefined && current.ownerId === ownerId) {
        await unlink(file).catch(() => undefined);
      }
    },
  };

  return lease;
}

export async function isOwner(
  paths: StorePaths,
  sessionId: string,
  ownerId: string,
): Promise<boolean> {
  const record = await readOwnerRecord(ownerFilePath(paths, sessionId));
  if (record === undefined || record.ownerId !== ownerId) return false;
  return Date.now() - record.heartbeatAt < record.ttlMs;
}

/** 读锁文件判断某个会话是否被某个实例持有（列表里显示用）。 */
export async function anyOwnerAlive(paths: StorePaths, sessionId: string): Promise<boolean> {
  const record = await readOwnerRecord(ownerFilePath(paths, sessionId));
  if (record === undefined) return false;
  return Date.now() - record.heartbeatAt < record.ttlMs;
}
