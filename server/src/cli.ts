/**
 * 命令行入口：解析启动参数、处理重启与状态查询，再交给服务主体。
 *
 * 生产入口：`pnpm start` 跑的就是本文件经 esbuild 打成的 `dist/` 产物；
 * 开发走 `server/src/main.ts`（tsx watch），不经这里。
 * 参数也面向「用自己开发自己」：`--restart` 先核对注册文件里的 pid 确实还在监听那个端口（见
 * `isRegisteredInstance`），再结束它，然后启动新实例；
 * 让服务生命周期由手动控制，避免开发环境 watch 重启打断正在进行的会话。
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { brand } from "@ucode/brand/values";

import { matchesInstance } from "./platform/instance";
import { resourceRoot } from "./platform/resources";
import {
  readServiceRegistration,
  type ServiceRegistration,
  toUrlHost,
} from "./platform/service-registration";

const HELP = `用法：${brand.name} [选项]

  --port <端口>   监听端口（覆盖 .env(.prod) 的默认值；0 表示自选可用端口）
  --host <地址>   监听地址（覆盖 .env(.prod) 的默认值）
  --open          启动后打开浏览器
  --restart       结束已在运行的实例后再启动
  --status        仅查询是否在运行，不启动（运行中退出码 0，否则 1）
  --version       打印版本
  -h, --help      打印帮助`;

/** 核对实例身份的超时：服务在跑就立即回，逾期说明端口上不是它 */
const INSTANCE_PROBE_TIMEOUT_MS = 1500;

const readVersion = (): string => {
  try {
    const manifest = JSON.parse(readFileSync(resolve(resourceRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

/** 进程是否存活：`kill(pid, 0)` 只探测，不实际发送信号 */
const isAlive = (pid: number): boolean => {
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
 * 复用给无关进程，而崩溃退出留下的陈旧 pid 在 Windows 上尤其常见（`SIGTERM` 不触发优雅退出）；
 * 也不依赖 `lsof` / `netstat` 这类外部命令，精简的 Linux 环境与 Windows 上都没有这个负担。
 * 探不到就返回 false（宁可不动：误杀一个无关进程比多留一个旧实例糟得多）。
 */
const isRegisteredInstance = async (registration: ServiceRegistration): Promise<boolean> => {
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
    if (!isAlive(pid)) return true;
    await new Promise((resume) => setTimeout(resume, 100));
  }
  return !isAlive(pid);
};

/**
 * 结束注册文件里记录的旧实例；pid 缺失、已死、或身份核对不过（陈旧 pid / 端口上是别的服务）时跳过。
 *
 * 比 `--status` 严：那边只判进程存活（轻量探针，可能把被复用的陈旧 pid 报成「运行中」），
 * 这里要多一次实例身份核对——结束进程不可逆，宁可留一个旧实例让用户手工处理。
 */
const stopRunning = async (servicePath: string): Promise<void> => {
  const registration = readServiceRegistration(servicePath);
  if (!registration || registration.pid === null || !isAlive(registration.pid)) return;

  const pid = registration.pid;
  if (!(await isRegisteredInstance(registration))) {
    console.warn(
      `pid ${pid} 未确认是本服务的实例（端口 ${registration.port} 上没有回报同一个 instanceId），跳过结束；` +
        "确认它确实该结束后可手工结束",
    );
    return;
  }
  console.log(`结束旧实例（pid ${pid}）…`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  if (await waitExit(pid, 5000)) return;

  console.warn("旧实例未在 5s 内退出，强制结束");
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // 已在等待期间退出
  }
  await waitExit(pid, 2000);
};

const openBrowser = (url: string): void => {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.warn(`打开浏览器失败，请手动访问 ${url}`));
  child.unref();
};

/** 未知参数会让 parseArgs 抛错，捕获后给出可读提示而不是裸堆栈 */
let parsed: {
  port?: string;
  host?: string;
  open: boolean;
  restart: boolean;
  status: boolean;
  version: boolean;
  help: boolean;
};
try {
  parsed = parseArgs({
    // pnpm 会把 `pnpm start -- --restart` 的 `--` 一并传下来（npm 会去掉它）；
    // 本 CLI 没有位置参数，裸 `--` 一律丢弃，否则文档里的写法会直接报「未知参数」
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      port: { type: "string" },
      host: { type: "string" },
      open: { type: "boolean", default: false },
      restart: { type: "boolean", default: false },
      status: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }).values;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${HELP}`);
  process.exit(1);
}

if (parsed.help) {
  console.log(HELP);
  process.exit(0);
}
if (parsed.version) {
  console.log(readVersion());
  process.exit(0);
}
if (parsed.port) process.env.APP_PORT = parsed.port;
if (parsed.host) process.env.APP_HOST = parsed.host;
// 默认走生产形态：跳过 pino-pretty（仅开发用）；日志级别由 APP_LOG_LEVEL 声明
process.env.NODE_ENV ??= "production";

const { env } = await import("./env");

if (parsed.status) {
  const registration = readServiceRegistration(env.servicePath);
  const running = registration !== null && registration.pid !== null && isAlive(registration.pid);
  if (!running) {
    console.log("未运行");
    process.exit(1);
  }
  const displayHost = toUrlHost(env.host);
  console.log(`运行中：http://${displayHost}:${registration.port}（pid ${registration.pid}）`);
  process.exit(0);
}

if (parsed.restart) await stopRunning(env.servicePath);

const { listening } = await import("./main");
const port = await listening;
const url = `http://${toUrlHost(env.host)}:${port}`;
console.log(`${brand.name} 已启动：${url}`);
if (parsed.open) openBrowser(url);
