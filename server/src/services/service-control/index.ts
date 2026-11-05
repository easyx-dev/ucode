/**
 * 服务进程的生命周期控制：后台启动 / 停止 / 重启 / 查询状态，供 CLI 的 `service …` 子命令使用。
 *
 * 与 `main.ts` 的前台启动共用同一份注册文件与身份核对规则：pid 会被系统复用，结束进程前必须确认
 * 端口上答话的就是注册文件描述的那个实例（见 `platform/instance`）。这里只回传结果与进度，
 * 呈现交给调用方——同一套动作被脚本调用时不该绑死在某套中文提示上。
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

import { matchesInstance } from "../../platform/instance";
import {
  readServiceRegistration,
  type ServiceRegistration,
  toUrlHost,
} from "../../platform/service-registration";

/** 核对实例身份的超时：服务在跑就立即回，逾期说明端口上不是它 */
const INSTANCE_PROBE_TIMEOUT_MS = 1500;
/** 后台实例的就绪等待：首次启动要建库、物化内置资产，留足余量 */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 150;
/** 结束实例：先礼后兵 */
const GRACEFUL_STOP_TIMEOUT_MS = 5000;
const FORCED_STOP_TIMEOUT_MS = 2000;
/** 失败时带出的日志尾部：行数与字节上限，长驻实例的日志不能整份读进来 */
const LOG_TAIL_LINES = 15;
const LOG_TAIL_BYTES = 4096;
/** 日志轮转上限：超过就在下次启动前换成 `service.log.1` */
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export type ServiceStatus = {
  /** 端口上确实跑着注册文件描述的那个实例 */
  running: boolean;
  /** 注册文件里的监听地址与端口（未运行也照实给出，便于排查） */
  host: string | null;
  port: number | null;
  /** 注册文件里的 pid（未确认存活时也有值，仅供排查） */
  pid: number | null;
  /** 可直接访问的地址；没有端口时为 null */
  url: string | null;
};

export type ServiceStartOptions = {
  /** `$APP_HOME/app/service.json` */
  servicePath: string;
  /** 后台实例的输出日志（追加写） */
  logPath: string;
  /** 服务入口：CLI 交来的构建产物，用同一个 node 可执行文件起子进程 */
  entryPath: string;
  /** 子进程环境：调用方必须带上解析好的 APP_HOME，否则后台实例会按自己的 cwd 重新解析 */
  env: NodeJS.ProcessEnv;
  /** 子进程 cwd（即调用方的 cwd）：环境文件的向上查找从这里开始 */
  cwd?: string;
  /** 端口 / 地址覆盖（不给则沿用环境配置与注册文件） */
  port?: string;
  host?: string;
  /** 进度提示（CLI 打到 stdout） */
  onProgress?: (message: string) => void;
};

export type ServiceStartResult =
  | { started: true; status: ServiceStatus }
  | { started: false; reason: "already-running"; status: ServiceStatus }
  | { started: false; reason: "failed"; message: string };

export type ServiceStopResult =
  | { stopped: true; pid: number }
  /**
   * 没有要结束的东西，或结束了但仍探测得到：注册文件缺失 / pid 已死 / 身份核对不过（陈旧 pid，
   * 或端口上是别的服务）/ 强杀之后进程仍在（不可中断状态）。
   */
  | { stopped: false; reason: "missing" | "dead" | "unverified" | "lingering"; pid: number | null };

/** 进程是否存活：`kill(pid, 0)` 只探测，不实际发送信号 */
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * 端口上的服务是不是注册文件描述的那个实例。
 *
 * 只认服务自己的回答（`GET /api/v1/health` 回报的 `instanceId`）：比核对 pid 更准——pid 会被系统
 * 复用给无关进程；也不依赖 `lsof` / `netstat` 这类外部命令。探不到就返回 false（宁可不动：
 * 误杀一个无关进程比多留一个旧实例糟得多）。
 */
const probeInstance = async (registration: ServiceRegistration): Promise<boolean> => {
  try {
    const response = await fetch(
      `http://${toUrlHost(registration.host)}:${registration.port}/api/v1/health`,
      { signal: AbortSignal.timeout(INSTANCE_PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) return false;
    return matchesInstance(registration.instanceId, await response.json());
  } catch {
    return false;
  }
};

/** 等待进程退出；超时返回 false */
const waitExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resume) => setTimeout(resume, 100));
  }
  return !isProcessAlive(pid);
};

const toStatus = (registration: ServiceRegistration | null, running: boolean): ServiceStatus => ({
  running,
  host: registration?.host ?? null,
  port: registration?.port ?? null,
  pid: registration?.pid ?? null,
  url:
    registration && registration.port > 0
      ? `http://${toUrlHost(registration.host)}:${registration.port}`
      : null,
});

/**
 * 查询状态：注册文件缺端口 / pid 已死都算未运行；进程活着但要再核对一次实例身份
 * （pid 被复用给无关进程时不能报「运行中」）。
 */
export const serviceStatus = async (servicePath: string): Promise<ServiceStatus> => {
  const registration = readServiceRegistration(servicePath);
  if (!registration || registration.pid === null) return toStatus(registration, false);
  const alive = isProcessAlive(registration.pid);
  return toStatus(registration, alive && (await probeInstance(registration)));
};

/**
 * 结束注册文件里的实例。pid 缺失 / 已死 / 身份核对不过一律跳过——结束进程不可逆，
 * 宁可留一个旧实例让人手工处理。
 */
export const stopService = async (options: {
  servicePath: string;
  onProgress?: (message: string) => void;
}): Promise<ServiceStopResult> => {
  const registration = readServiceRegistration(options.servicePath);
  const pid = registration?.pid ?? null;
  if (!registration || pid === null) return { stopped: false, reason: "missing", pid };
  if (!isProcessAlive(pid)) return { stopped: false, reason: "dead", pid };
  if (!(await probeInstance(registration))) return { stopped: false, reason: "unverified", pid };

  options.onProgress?.(`结束实例（pid ${pid}）…`);
  // Windows 上 SIGTERM 不触发优雅退出，但会结束进程；其余平台走 main 的优雅关闭
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { stopped: false, reason: "dead", pid };
  }
  if (await waitExit(pid, GRACEFUL_STOP_TIMEOUT_MS)) return { stopped: true, pid };

  options.onProgress?.(`实例未在 ${GRACEFUL_STOP_TIMEOUT_MS / 1000}s 内退出，强制结束`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // 已在等待期间退出
  }
  if (await waitExit(pid, FORCED_STOP_TIMEOUT_MS)) return { stopped: true, pid };
  // 强杀都没杀掉（如不可中断状态）：报成功会让用户以为端口已释放，据实回一个独立结果
  return { stopped: false, reason: "lingering", pid };
};

/**
 * 日志尾部：子进程起不来时，线索全在它自己的输出里。
 * 只读末尾一小段——常驻实例的日志可能有几百 MB，整份读进来本身就是一次事故。
 */
const tailLog = (logPath: string): string => {
  let fd: number | undefined;
  try {
    fd = openSync(logPath, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const filled = readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.subarray(0, filled).toString("utf8").trimEnd().split("\n");
    // 从中间读起时首行是半截的（甚至切在多字节字符上），去掉它
    if (size > length) lines.shift();
    return lines.slice(-LOG_TAIL_LINES).join("\n");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/**
 * 日志轮转：每个请求一行、实例常驻数月，没有上限就不是「日志」而是「积压」。
 * 只在启动前轮转：那时旧实例刚被停掉，没有别的进程还在往这个文件里写。
 */
const rotateLog = (logPath: string): void => {
  try {
    if (statSync(logPath).size < LOG_ROTATE_BYTES) return;
    // Windows 上 rename 不覆盖已存在的目标，先删掉上一份
    rmSync(`${logPath}.1`, { force: true });
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // 文件不存在 / 挪不动都不阻断启动
  }
};

/**
 * 起后台实例：脱离终端的独立进程组，输出进日志文件。
 * 子进程环境必须带上调用方解析好的 `APP_HOME`，否则它按自己的 cwd 重新解析一遍，可能落到别处。
 * 日志目录先建：首次启动时 `$APP_HOME/app/` 还不存在（建目录本来由 env 干，而这里刻意不加载 env）。
 */
const spawnService = (options: ServiceStartOptions) => {
  const args = [options.entryPath, "serve"];
  if (options.port) args.push("--port", options.port);
  if (options.host) args.push("--host", options.host);

  mkdirSync(dirname(options.logPath), { recursive: true });
  rotateLog(options.logPath);
  const fd = openSync(options.logPath, "a");
  try {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    child.unref();
    return child;
  } finally {
    closeSync(fd);
  }
};

/** 等本次拉起的进程写回注册文件并答话；进程提前退出或超时返回 null */
const waitReady = async (
  options: ServiceStartOptions,
  expectedPid: number | undefined,
): Promise<ServiceStatus | null> => {
  if (expectedPid === undefined) return null;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await serviceStatus(options.servicePath);
    // 认 pid：注册文件此时可能还写着上次的实例，只有本次拉起的进程写回后才算就绪
    if (status.running && status.pid === expectedPid) return status;
    if (!isProcessAlive(expectedPid)) return null;
    await new Promise((resume) => setTimeout(resume, READY_POLL_INTERVAL_MS));
  }
  return null;
};

/** 后台启动；已在运行时不再起第二个实例 */
export const startService = async (options: ServiceStartOptions): Promise<ServiceStartResult> => {
  const current = await serviceStatus(options.servicePath);
  if (current.running) return { started: false, reason: "already-running", status: current };

  const child = spawnService(options);
  const status = await waitReady(options, child.pid);
  if (status) return { started: true, status };

  const tail = tailLog(options.logPath);
  return {
    started: false,
    reason: "failed",
    message:
      tail ||
      `后台实例未在 ${READY_TIMEOUT_MS / 1000}s 内就绪，也没有留下日志（${options.logPath}）`,
  };
};

/** 重启：先结束旧实例（没有也算正常），再起新的 */
export const restartService = async (
  options: ServiceStartOptions,
): Promise<{ stop: ServiceStopResult; start: ServiceStartResult }> => {
  const stop = await stopService({
    servicePath: options.servicePath,
    onProgress: options.onProgress,
  });
  const start = await startService(options);
  return { stop, start };
};
