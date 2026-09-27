import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDir } from "@ucode/branding/node";

/**
 * 服务注册与发现（BS 架构的地基）。
 *
 * `service` 子命令是常驻的唯一后端，壳都是客户端。客户端要连上它，就得先知道"它在哪"：
 * 因此服务启动后把 pid 与端点写进**宿主运行时目录**（不是数据层目录——那是被迁移与
 * 支持包带走的状态，一个陈旧 pid 会误导另一个进程）。
 *
 * 三个不变量：
 * 1. **一个数据层一个服务**：用 `<运行时目录>/service-<数据层指纹>.lock` 互斥，
 *    句柄由服务自己持有到退出；陈旧锁靠 pid 存活探测 + 端点探测窃取。
 * 2. **注册表只是线索，不是事实**：`findLiveService` 一定做端点探测，
 *    因此 kill -9 留下的注册文件不会被误认为"服务还活着"。
 * 3. **日志在被 detach 之前就定好位置**：服务是 detached 起的，它的 stderr 直接接到
 *    日志文件（父进程不留管道），否则壳一退出服务就写到一个断掉的管道上。
 */

export type ServiceEndpoints = {
  /** unix socket 路径（壳的首选通路：受文件权限约束，且不占端口）。 */
  unix?: string;
  /** 环回 HTTP 端点（浏览器需要它：浏览器连不了 unix socket）。 */
  http?: string;
};

export type ServiceRegistration = {
  pid: number;
  /** 核心层实例标识（诊断用：确认连上的确实是这个服务）。 */
  coreId: string;
  dataDir: string;
  startedAt: string;
  endpoints: ServiceEndpoints;
  logFile: string;
  /** 起这个服务的 CLI 版本：常驻进程可能比壳旧，"对不上"时要能一眼看出来。 */
  version: string;
};

export type ServicePaths = {
  dir: string;
  registry: string;
  lock: string;
  socket: string | undefined;
  log: string;
};

/**
 * unix socket 路径长度受内核限制（macOS `sun_path` 104 字节）。
 * 超了就不给 socket，退回"只用环回 HTTP"——宁可少一条通路，也不要起不来。
 */
const MAX_SOCKET_PATH_BYTES = 100;

/** 服务按数据层目录区分：同一个目录只能有一个后端。 */
export function servicePaths(dataDir: string, dir: string = runtimeDir()): ServicePaths {
  const key = createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 12);
  const socket = join(dir, `socket-${key}.sock`);
  return {
    dir,
    registry: join(dir, `service-${key}.json`),
    lock: join(dir, `service-${key}.lock`),
    socket: Buffer.byteLength(socket, "utf8") <= MAX_SOCKET_PATH_BYTES ? socket : undefined,
    log: join(dir, `service-${key}.log`),
  };
}

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
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
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

export type LiveService = { paths: ServicePaths; registration: ServiceRegistration };

/** 发现：注册表 + pid + 端点三重确认，任一不过都当"没有服务"。 */
export async function findLiveService(dataDir: string): Promise<LiveService | undefined> {
  const paths = servicePaths(dataDir);
  const registration = await readRegistration(paths);
  if (registration === undefined) return undefined;
  if (!isProcessAlive(registration.pid)) return undefined;
  if (!(await probeRegistration(registration))) return undefined;
  return { paths, registration };
}

export class ServiceConflictError extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(
      `数据层已有一个在跑的服务（pid=${pid}）。用 \`service status\` 查看，或先 \`service stop\`。`,
    );
    this.name = "ServiceConflictError";
    this.pid = pid;
  }
}

/**
 * 取服务句柄（由服务自己持有到退出）。
 *
 * 陈旧判定不能只看 pid：pid 会被复用。因此"锁在、但端点探测不通"一律当陈旧窃取，
 * 否则一次 kill -9 会让这个数据层再也起不来服务。
 */
export async function acquireServiceLock(
  paths: ServicePaths,
  dataDir: string,
): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const handle = await open(paths.lock, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
        "utf8",
      );
      await handle.close();
      return async () => {
        await unlink(paths.lock).catch(() => undefined);
      };
    } catch {
      const live = await findLiveService(dataDir);
      if (live !== undefined) throw new ServiceConflictError(live.registration.pid);
      await unlink(paths.lock).catch(() => undefined);
    }
  }
  throw new Error("取服务锁失败：锁文件反复被其他进程占用。");
}

/** CLI 入口（dev 直跑源码、安装形态跑 dist）。 */
function cliEntry(): string {
  const source = fileURLToPath(new URL("./main.ts", import.meta.url));
  if (existsSync(source)) return source;
  return fileURLToPath(new URL("./main.js", import.meta.url));
}

export type SpawnServiceOptions = {
  dataDir: string;
  cwd: string;
  host: string;
  port?: number;
  allowNonLoopback?: boolean;
  noHttp?: boolean;
};

/**
 * 后台拉起服务：**detached + stdout/stderr 直接接日志文件**。
 *
 * 不用管道：壳退出后管道会断，服务后续所有输出都会写失败。
 */
export async function spawnService(options: SpawnServiceOptions): Promise<void> {
  const paths = servicePaths(options.dataDir);
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  const logHandle = await open(paths.log, "a", 0o600);
  const args = [
    "--conditions=dev-src",
    cliEntry(),
    "service",
    "start",
    "--foreground",
    "--data-dir",
    options.dataDir,
    "--cwd",
    options.cwd,
    "--host",
    options.host,
    ...(options.port === undefined ? [] : ["--port", String(options.port)]),
    ...(options.allowNonLoopback === true ? ["--allow-non-loopback"] : []),
    ...(options.noHttp === true ? ["--no-http"] : []),
  ];
  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    });
    child.unref();
  } finally {
    await logHandle.close();
  }
}

/** 等服务就绪：轮询注册表并探测端点。 */
export async function waitForService(dataDir: string, timeoutMs = 15_000): Promise<LiveService> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const live = await findLiveService(dataDir);
    if (live !== undefined) return live;
    if (Date.now() > deadline) {
      const paths = servicePaths(dataDir);
      throw new Error(`等待服务就绪超时（${timeoutMs}ms）。请查看日志：${paths.log}`);
    }
    await new Promise((done) => setTimeout(done, 150));
  }
}

/**
 * 拿一个可用的服务：已有就复用，没有就拉起。
 *
 * 这是壳唯一的入口——壳不该关心服务是刚起的还是本来就在跑。
 */
export async function ensureService(options: SpawnServiceOptions): Promise<LiveService> {
  const existing = await findLiveService(options.dataDir);
  if (existing !== undefined) return existing;
  const paths = servicePaths(options.dataDir);
  await spawnService(options);
  return waitForService(options.dataDir).catch(async (error: unknown) => {
    // 并发竞态：另一个壳可能刚把服务拉起来（它抢到了锁，我们起的那个自会退出）。
    const raced = await findLiveService(options.dataDir);
    if (raced !== undefined) return raced;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}（日志：${paths.log}）`,
    );
  });
}

/** 优雅停止：SIGTERM 后等它自己收尾（释放 owner 租约、清注册文件）。 */
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
