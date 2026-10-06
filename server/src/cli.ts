/**
 * 命令行入口：解析启动参数、处理重启与状态查询，再交给服务主体。
 *
 * 生产入口：`pnpm start` 跑的就是本文件经 esbuild 打成的 `dist/` 产物；
 * 开发走 `server/src/index.ts`（tsx watch），不经这里。
 * 参数也面向「用自己开发自己」：`--restart` 按注册文件的 pid 结束旧实例再启动，
 * 让服务生命周期由手动控制，避免开发环境 watch 重启打断正在进行的会话。
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { brand } from "@ucode/brand/values";

import { resourceRoot } from "./lib/app-paths";
import { readServiceRegistration } from "./lib/service-file";

const HELP = `用法：${brand.name} [选项]

  --port <端口>   监听端口（覆盖 .env(.prod) 的默认值；0 表示自选可用端口）
  --host <地址>   监听地址（覆盖 .env(.prod) 的默认值）
  --open          启动后打开浏览器
  --restart       结束已在运行的实例后再启动
  --status        仅查询是否在运行，不启动（运行中退出码 0，否则 1）
  --version       打印版本
  -h, --help      打印帮助`;

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
 * pid 是否就是监听在该端口的本服务进程。
 * 崩溃退出会留下陈旧 pid，若恰好被系统复用，仅凭存活判定会误杀无关进程；用「端口归属」核对身份。
 * lsof 找不到匹配时以非零码退出（故用 spawnSync 避免被当成异常）；lsof 自身不可用时退化为存活判定（返回 true）。
 */
const isServicePid = (pid: number, port: number): boolean => {
  if (process.platform === "win32") return true;
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  if (result.error) return true;
  return result.stdout.split("\n").some((line) => Number(line.trim()) === pid);
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

/** 结束注册文件里记录的旧实例；pid 缺失、已死、或与端口不匹配（疑似复用）时跳过 */
const stopRunning = async (servicePath: string): Promise<void> => {
  const registration = readServiceRegistration(servicePath);
  if (!registration || registration.pid === null || !isAlive(registration.pid)) return;

  const pid = registration.pid;
  if (!isServicePid(pid, registration.port)) {
    console.warn(`pid ${pid} 未监听端口 ${registration.port}，疑似已被复用，跳过结束`);
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

/** 通配监听地址不可直接访问，展示 / 打开时改用回环 */
const toDisplayHost = (host: string): string =>
  host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

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
    args: process.argv.slice(2),
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
  const displayHost = toDisplayHost(env.host);
  console.log(`运行中：http://${displayHost}:${registration.port}（pid ${registration.pid}）`);
  process.exit(0);
}

if (parsed.restart) await stopRunning(env.servicePath);

const { listening } = await import("./index");
const port = await listening;
const url = `http://${toDisplayHost(env.host)}:${port}`;
console.log(`${brand.name} 已启动：${url}`);
if (parsed.open) openBrowser(url);
