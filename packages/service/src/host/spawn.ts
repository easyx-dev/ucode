import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import type { ServicePaths } from "../paths.ts";
import { findLiveService, type LiveService } from "./registry.ts";

/**
 * 拉起与等待服务。
 *
 * 重入参数由调用方给出（`command`）：库不假设 CLI 的目录布局——安装形态、桌面壳的
 * 打包产物、测试里的临时入口都能复用这套逻辑。
 */

export type ServiceCommand = {
  /** 可执行文件：dev 下是 `process.execPath`，Electron 里是带 `ELECTRON_RUN_AS_NODE` 的自身。 */
  executable: string;
  /** 以"前台服务"重新启动自己的参数。 */
  args: string[];
};

export type SpawnServiceOptions = {
  paths: ServicePaths;
  command: ServiceCommand;
  /** 追加的环境变量（在继承的进程环境之上）。 */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

/**
 * 后台拉起服务：**detached + stdout/stderr 直接接日志文件**。
 *
 * 不用管道：壳退出后管道会断，服务后续所有输出都会写失败。
 * 日志位置在 detach 之前就定好，父进程不留任何句柄。
 */
export async function spawnService(options: SpawnServiceOptions): Promise<void> {
  await mkdir(options.paths.runtimeDir, { recursive: true, mode: 0o700 });
  const logHandle = await open(options.paths.log, "a", 0o600);
  try {
    const child = spawn(options.command.executable, options.command.args, {
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: { ...process.env, ...options.env },
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    child.unref();
  } finally {
    await logHandle.close();
  }
}

/** 等服务就绪：轮询注册表并探测端点。 */
export async function waitForService(
  paths: ServicePaths,
  timeoutMs = 15_000,
): Promise<LiveService> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const live = await findLiveService(paths);
    if (live !== undefined) return live;
    if (Date.now() > deadline) {
      throw new Error(`等待服务就绪超时（${timeoutMs}ms）。请查看日志：${paths.log}`);
    }
    await new Promise((done) => setTimeout(done, 150));
  }
}

export type EnsureServiceOptions = SpawnServiceOptions & { timeoutMs?: number };

/**
 * 拿一个可用的服务：已有就复用，没有就拉起。这是壳与 CLI 唯一的入口——
 * 调用方不需要关心服务是刚起的还是本来就在跑。
 */
export async function ensureService(options: EnsureServiceOptions): Promise<LiveService> {
  const existing = await findLiveService(options.paths);
  if (existing !== undefined) return existing;
  await spawnService(options);
  return waitForService(options.paths, options.timeoutMs).catch(async (error: unknown) => {
    // 并发竞态：另一个壳可能刚把服务拉起来（它抢到了锁，我们起的那个自会退出）。
    const raced = await findLiveService(options.paths);
    if (raced !== undefined) return raced;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}（日志：${options.paths.log}）`,
    );
  });
}
