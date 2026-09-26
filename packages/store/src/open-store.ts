import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import {
  CURRENT_DATA_LAYER_VERSION,
  DataLayerError,
  type DataLayerVersion,
  type IndexedSession,
  type OwnerLease,
  parseDataLayerVersion,
  type SessionRepo,
  type Store,
  type StoreFactory,
  type StoreOptions,
} from "@ucode/data-layer-spec";
import { writeFileAtomic } from "./atomic.ts";
import {
  assertPermissions,
  assertSafeSessionId,
  assertVersionReadable,
  detectDangerousFileSystem,
  resolveWithin,
} from "./guards.ts";
import { invalidateIndex, readIndex, scanSessions, writeIndex } from "./index-cache.ts";
import { managedDirs, resolveDataDir, storePaths } from "./layout.ts";
import { acquireOwner, isOwner } from "./owner.ts";
import { createSessionRepo, openSessionRepo } from "./session-repo.ts";

/**
 * 打开数据层（spec §4.2 的第一步）。
 *
 * 顺序是有讲究的：权限 / 危险文件系统 / 版本前向拒绝都在这一层完成——
 * 宁可拒绝启动，也不带着不确定的假设继续跑。
 */
export const openStore: StoreFactory = async (options: StoreOptions) => {
  const now = options.now ?? ((): Date => new Date());
  const dataDir = resolveDataDir(options.dataDir);
  const paths = storePaths(dataDir);

  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  const dangerCheck = options.guards?.dangerousFileSystem ?? detectDangerousFileSystem;
  const danger = await dangerCheck(dataDir);
  if (danger.dangerous) {
    throw new DataLayerError(
      "dangerous_filesystem",
      `数据层目录 ${dataDir} 不可用：${danger.reason ?? "危险文件系统"}`,
      { dataDir, reason: danger.reason },
    );
  }

  if (options.guards?.requirePermissions !== false) {
    await assertPermissions(dataDir);
  }

  const version = await readOrInitVersion(paths.versionFile);
  assertVersionReadable(version);

  for (const dir of managedDirs(paths)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  const ownerId =
    options.ownerId ?? `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
  const globalLockTimeoutMs = options.locks?.globalLockTimeoutMs ?? 5_000;

  const store: Store = {
    dataDir,
    version,
    paths,
    ownerId,

    async createSession(input): Promise<SessionRepo> {
      const repo = await createSessionRepo({
        paths,
        cwd: input.cwd,
        id: input.id,
        createdAt: input.createdAt,
        parentSession: input.parentSession,
        now,
        onAppend: () => invalidateIndex(paths),
      });
      await invalidateIndex(paths);
      return repo;
    },

    async openSession(id, openOptions): Promise<SessionRepo | undefined> {
      assertSafeSessionId(id);
      return openSessionRepo({ paths, id, cwd: openOptions?.cwd, now });
    },

    async listSessions(listOptions): Promise<IndexedSession[]> {
      const { index, valid } = await readIndex(paths);
      const sessions =
        valid && index !== undefined ? index.sessions : await scanSessions(paths, { now });
      if (!valid) await writeIndex(paths, sessions, now);
      return listOptions?.cwd === undefined
        ? sessions
        : sessions.filter((session) => session.cwd === listOptions.cwd);
    },

    async acquireOwner(sessionId, ownerOptions): Promise<OwnerLease | undefined> {
      assertSafeSessionId(sessionId);
      return acquireOwner({
        paths,
        sessionId,
        ownerId,
        ttlMs: ownerOptions?.ttlMs,
        globalLockTimeoutMs,
        now,
        // 抢占时先处置前任可能留下的损坏尾部（spec §3.12 的抢占流程）
        repairTail: async () => {
          const repo = await openSessionRepo({ paths, id: sessionId, now });
          if (repo === undefined) return { truncatedBytes: 0, cursor: 0 };
          return repo.repairTail();
        },
      });
    },

    async isOwner(sessionId): Promise<boolean> {
      assertSafeSessionId(sessionId);
      return isOwner(paths, sessionId, ownerId);
    },

    async rebuildIndex(): Promise<IndexedSession[]> {
      const sessions = await scanSessions(paths, { now });
      await writeIndex(paths, sessions, now);
      return sessions;
    },

    async reconcileIndex(): Promise<{ rebuilt: boolean; sessions: IndexedSession[] }> {
      const { index, valid } = await readIndex(paths);
      if (valid && index !== undefined) {
        return { rebuilt: false, sessions: index.sessions };
      }
      const sessions = await scanSessions(paths, { now });
      await writeIndex(paths, sessions, now);
      return { rebuilt: true, sessions };
    },

    async writeAtomic(relativePath, contents, writeOptions): Promise<void> {
      const target = resolveWithin(dataDir, relativePath);
      const parent = relativePath.split("/").slice(0, -1).join("/");
      await mkdir(parent === "" ? dataDir : resolveWithin(dataDir, parent), {
        recursive: true,
        mode: 0o700,
      });
      await writeFileAtomic(target, contents, { mode: writeOptions?.mode });
    },

    async close(): Promise<void> {
      // owner 租约是独立对象，由持有者显式释放；这里没有需要收尾的全局状态。
    },
  };

  return store;
};

/**
 * 读版本文件；首次打开则写入当前版本。
 * 文件存在但格式非法时**拒绝启动**——版本信息是"能不能安全读这个目录"的依据，不能猜。
 */
async function readOrInitVersion(file: string): Promise<DataLayerVersion> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    const version: DataLayerVersion = {
      protocolVersion: CURRENT_DATA_LAYER_VERSION.protocolVersion,
      minReadableVersion: CURRENT_DATA_LAYER_VERSION.minReadableVersion,
    };
    await writeFileAtomic(file, JSON.stringify(version), { mode: 0o600 });
    return version;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new DataLayerError("data_layer_broken", `版本文件不是合法 JSON：${file}`);
  }
  const version = parseDataLayerVersion(parsedJson);
  if (version === undefined) {
    throw new DataLayerError(
      "data_layer_broken",
      `版本文件缺少 protocolVersion/minReadableVersion：${file}`,
    );
  }
  return version;
}
