import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { DATA_FORMAT_VERSION, type ServicePaths } from "../paths.ts";

/**
 * 服务注册与发现（BS 架构的地基）。
 *
 * 客户端要连上服务，先得知道"它在哪"：服务启动后把 pid 与端点写进运行时目录
 * （`<数据根>/runtime/`，与数据分开——那些是活句柄与本次运行的日志，会被重启清掉）。
 *
 * 三条不变量：
 * 1. **一个数据根一个服务**：`service.lock` 由服务自己以"独占创建"取得并持有到退出。
 * 2. **注册表只是线索，不是事实**：判活一定做端点探测，
 *    因此 `kill -9` 留下的注册文件不会被误认为"服务还活着"。
 * 3. **数据格式版本不一致的服务不复用**：跨版本的服务连上去只会读到解释不了的数据，
 *    宁可让用户看到"请先停止旧服务"，也不要静默接错。
 */

export type ServiceEndpoints = {
  /** unix socket 路径（本机首选通路：受文件权限约束，且不占端口）。 */
  unix?: string;
  /** 环回 HTTP 端点（浏览器连不了 unix socket，必须有它）。 */
  http?: string;
};

export type ServiceRegistration = {
  pid: number;
  /** 服务实例标识（诊断用：确认连上的确实是这个服务）。 */
  serviceId: string;
  /** 数据格式版本：与客户端的构建对不上就不复用。 */
  dataVersion: string;
  /** 版本目录的绝对路径（数据在哪；数据根由客户端自己解析）。 */
  dataDir: string;
  startedAt: string;
  endpoints: ServiceEndpoints;
  logFile: string;
  /** 起这个服务的版本：常驻进程可能比壳旧，"对不上"时要能一眼看出来。 */
  version: string;
};

export type LiveService = { paths: ServicePaths; registration: ServiceRegistration };

/**
 * 启动宽限期：锁里的 pid 还活着、但服务可能正在启动（注册表还没写出来）时，
 * 这段时间内一律当"有人在当服务"，不去抢它的锁。
 */
const STARTUP_GRACE_MS = 60_000;

function isRegistration(raw: unknown): raw is ServiceRegistration {
  if (typeof raw !== "object" || raw === null) return false;
  const value = raw as Record<string, unknown>;
  return typeof value.pid === "number" && typeof value.dataDir === "string";
}

export async function readRegistration(
  paths: ServicePaths,
): Promise<ServiceRegistration | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(paths.registry, "utf8"));
    return isRegistration(parsed) ? parsed : undefined;
  } catch {
    return undefined; // 不存在或损坏都当"没有服务"
  }
}

export async function writeRegistration(
  paths: ServicePaths,
  registration: ServiceRegistration,
): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  const tmp = `${paths.registry}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(registration, null, 2), { mode: 0o600 });
  await rename(tmp, paths.registry);
}

export async function clearRegistration(paths: ServicePaths): Promise<void> {
  await unlink(paths.registry).catch(() => undefined);
}

/** 进程是否还在（信号 0 只做权限与存在性检查，不真的发信号）。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 端点探测：能连上才算活着。注册文件可能来自一个已被 kill -9 的进程。 */
export async function probeRegistration(
  registration: ServiceRegistration,
  timeoutMs = 1_500,
): Promise<boolean> {
  const { unix, http } = registration.endpoints;
  if (unix !== undefined) return probeUnix(unix, timeoutMs);
  if (http !== undefined) return probeHttp(http, timeoutMs);
  return false;
}

function probeUnix(socketPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect(socketPath);
    const done = (ok: boolean): void => {
      socket.destroy();
      resolveProbe(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

async function probeHttp(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/** 三重确认（注册表 + pid + 端点），不看数据格式版本：判"这个数据根上还有服务在跑吗"。 */
export async function readLiveRegistration(
  paths: ServicePaths,
): Promise<ServiceRegistration | undefined> {
  const registration = await readRegistration(paths);
  if (registration === undefined) return undefined;
  if (!isProcessAlive(registration.pid)) return undefined;
  if (!(await probeRegistration(registration))) return undefined;
  return registration;
}

/** 客户端复用服务的判据：活着，且数据格式版本与本构建一致。 */
export async function findLiveService(paths: ServicePaths): Promise<LiveService | undefined> {
  const registration = await readLiveRegistration(paths);
  if (registration === undefined) return undefined;
  if (registration.dataVersion !== DATA_FORMAT_VERSION) return undefined;
  return { paths, registration };
}

export class ServiceConflictError extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(
      `这个数据根上已有一个在跑的服务（pid=${pid}）。用 \`service status\` 查看，或先 \`service stop\`。`,
    );
    this.name = "ServiceConflictError";
    this.pid = pid;
  }
}

type LockHolder = { pid: number; at: string };

/** 读锁文件里的持有者；读不出或格式不对都返回 undefined（当陈旧锁处理）。 */
async function readLockHolder(paths: ServicePaths): Promise<LockHolder | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(paths.lock, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = parsed as Record<string, unknown>;
    if (typeof value.pid !== "number" || typeof value.at !== "string") return undefined;
    return { pid: value.pid, at: value.at };
  } catch {
    return undefined;
  }
}

/** 内容先写临时文件再 `link` 到锁文件：`link` 在目标存在时失败，于是"抢锁"与"写入持有者"是一步。 */
async function createLockFile(paths: ServicePaths): Promise<void> {
  const tmp = `${paths.lock}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), {
    mode: 0o600,
  });
  try {
    await link(tmp, paths.lock);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * 谁在挡着我们当服务（返回它的 pid）。
 *
 * 判定顺序就是优先级：**注册表活着**最硬（端点探测通过，说明真的在服务）；
 * 其次是**锁被一个还活着的 pid 持有且未过启动宽限期**（可能是正在启动、还没写注册表的服务）。
 * 两者都不成立才允许窃取陈旧锁——只看 pid 会被 pid 复用坑到，只看锁文件又会被启动竞态坑到。
 */
async function findBlockingService(paths: ServicePaths): Promise<number | undefined> {
  const live = await readLiveRegistration(paths);
  if (live !== undefined) return live.pid;
  const holder = await readLockHolder(paths);
  if (holder === undefined || !isProcessAlive(holder.pid)) return undefined;
  const startedAt = Date.parse(holder.at);
  const isFresh = Number.isFinite(startedAt) && Date.now() - startedAt < STARTUP_GRACE_MS;
  return isFresh ? holder.pid : undefined;
}

async function throwIfBlocked(paths: ServicePaths): Promise<void> {
  const blocker = await findBlockingService(paths);
  if (blocker !== undefined) throw new ServiceConflictError(blocker);
}

/**
 * 取实例锁（由服务自己持有到退出）。
 *
 * 抢锁前后各判一次"谁在挡着"：只看锁文件会漏掉"锁被人删了、服务还活着"的情形，
 * 只看活服务又会在并发启动时两个进程都通过——两处都查才同时在两种情形下都拦得住。
 * 释放只删自己写的那把锁：锁被别的进程窃取过时，不替对方清场。
 */
export async function acquireInstanceLock(paths: ServicePaths): Promise<() => Promise<void>> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await throwIfBlocked(paths);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await createLockFile(paths);
      return async () => {
        const holder = await readLockHolder(paths);
        if (holder?.pid === process.pid) await unlink(paths.lock).catch(() => undefined);
      };
    } catch {
      await throwIfBlocked(paths);
      await unlink(paths.lock).catch(() => undefined);
    }
  }
  throw new Error("取服务锁失败：锁文件反复被其他进程占用。");
}

/** 优雅停止：SIGTERM 后等它自己收尾（清注册文件、关绑定）。 */
export async function stopService(
  registration: ServiceRegistration,
  timeoutMs = 10_000,
): Promise<boolean> {
  if (!isProcessAlive(registration.pid)) return true;
  try {
    process.kill(registration.pid, "SIGTERM");
  } catch {
    return true;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(registration.pid)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}
