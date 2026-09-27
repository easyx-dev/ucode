import { mkdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { managedDirs, type ServicePaths, servicePaths } from "../paths.ts";
import type { IndexedSession, SessionRepo } from "./contracts.ts";
import { openDatabase } from "./database.ts";
import { StorageError } from "./errors.ts";
import { assertPermissions, detectDangerousFileSystem } from "./guards.ts";
import { createSessionId } from "./naming.ts";
import { createSessionRepo, openSessionRepo } from "./session-file.ts";
import {
  listSessions as listIndexedSessions,
  rebuildIndex,
  refreshIndexIfStale,
  setSessionArchived,
  setSessionName,
  touchSession,
  upsertSession,
} from "./session-index.ts";

/**
 * 服务存储门面：会话正文（JSONL）+ 索引与元数据（SQLite）。
 *
 * 打开顺序是有讲究的：权限与危险文件系统检查在前——**宁可拒绝启动，也不带着不确定的
 * 假设继续跑**（网络盘上的锁与变更通知都不可靠，会静默地坏数据）。
 */
export type ServiceStore = {
  readonly paths: ServicePaths;
  readonly db: DatabaseSync;
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
  rebuildIndex(): Promise<IndexedSession[]>;
  setName(id: string, name: string | null): void;
  setArchived(id: string, archived: boolean): void;
  close(): void;
};

export type CreateStoreOptions = {
  root: string;
  now?: () => Date;
  guards?: {
    /** 权限校验：默认开启。拒绝启动而不是静默修正权限。 */
    requirePermissions?: boolean;
    /** 危险文件系统探测：默认查已知云同步目录 + statfs 文件系统类型。 */
    dangerousFileSystem?: (
      root: string,
    ) => { dangerous: boolean; reason?: string } | Promise<{ dangerous: boolean; reason?: string }>;
  };
};

export async function createServiceStore(options: CreateStoreOptions): Promise<ServiceStore> {
  const paths = servicePaths(options.root);
  const now = options.now ?? ((): Date => new Date());

  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const dangerCheck = options.guards?.dangerousFileSystem ?? detectDangerousFileSystem;
  const danger = await dangerCheck(paths.root);
  if (danger.dangerous) {
    throw new StorageError(
      "dangerous_filesystem",
      `数据根 ${paths.root} 不可用：${danger.reason ?? "危险文件系统"}`,
      { root: paths.root },
    );
  }
  if (options.guards?.requirePermissions !== false) await assertPermissions(paths.root);

  for (const dir of managedDirs(paths)) await mkdir(dir, { recursive: true, mode: 0o700 });

  const database = openDatabase(paths.database);
  await refreshIndexIfStale(database, paths.sessions);

  return {
    paths,
    db: database,

    async createSession(input): Promise<SessionRepo> {
      const createdAt = input.createdAt ?? now();
      const id = input.id ?? createSessionId(createdAt);
      const repo = await createSessionRepo({
        paths,
        cwd: input.cwd,
        id,
        createdAt,
        parentSession: input.parentSession,
        now,
        onAppend: async (record) => touchSession(database, id, record.seq),
      });
      upsertSession(database, {
        id,
        cwd: input.cwd,
        name: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        entryCount: 0,
        firstMessage: null,
        archived: false,
      });
      return repo;
    },

    async openSession(id, openOptions): Promise<SessionRepo | undefined> {
      return openSessionRepo({
        paths,
        id,
        cwd: openOptions?.cwd,
        now,
        onAppend: async (record) => touchSession(database, id, record.seq),
      });
    },

    async listSessions(listOptions): Promise<IndexedSession[]> {
      await refreshIndexIfStale(database, paths.sessions);
      return listIndexedSessions(database, listOptions ?? {});
    },

    rebuildIndex(): Promise<IndexedSession[]> {
      return rebuildIndex(database, paths.sessions);
    },

    setName(id: string, name: string | null): void {
      setSessionName(database, id, name);
    },

    setArchived(id: string, archived: boolean): void {
      setSessionArchived(database, id, archived);
    },

    close(): void {
      database.close();
    },
  };
}
