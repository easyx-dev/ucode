/**
 * 命令行入口：解析命令与参数，前台启动交给 `main`，`service` 子命令交给 `services/service-control`。
 *
 * 前台启动是主路径：`pnpm start` 跑的就是本文件经 esbuild 打成的 `dist/` 产物（npm 安装后 `bin` 也指向它），
 * 开发走 `server/src/main.ts`（tsx watch），不经这里。
 * `service start` 起的是同一个产物的后台实例，只是脱离终端、输出进 `$APP_HOME/app/service.log`；
 * 服务的生命周期由显式命令控制，不用 watch 重启打断正在进行的会话（见 README「生产启动与自迭代」）。
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { brand } from "@ucode/brand/values";

import { SERVICE_LOG_FILENAME } from "./constants/dirs";
import { type AppHome, loadAppHome } from "./platform/app-home";
import { readServiceRegistration, toUrlHost } from "./platform/service-registration";
import { serviceVersion } from "./platform/version";
import {
  restartService,
  type ServiceStartOptions,
  serviceStatus,
  startService,
  stopService,
} from "./services/service-control";

const HELP = `用法：${brand.name} [命令] [选项]

命令：
  serve                          前台启动（默认命令）
  service start | restart        后台启动 / 重启：脱离终端运行，日志进 $APP_HOME/app/service.log
  service stop                   结束后台实例
  service status                 查询是否在运行（运行中退出码 0，否则 1）

选项：
  --port <端口>   监听端口（覆盖环境配置；0 表示自选可用端口）
  --host <地址>   监听地址（覆盖环境配置）
  --open          启动后打开浏览器（前台启动与 service start | restart 都认）
  --version       打印版本
  -h, --help      打印帮助`;

type CliOptions = {
  port?: string;
  host?: string;
  open: boolean;
};

/** 错误提示统一带上帮助：子命令写法不对时，光看一行报错还得再翻一次文档 */
const fail = (message: string): never => {
  console.error(message);
  console.error(`\n${HELP}`);
  process.exit(1);
};

/** 注册文件指向的进程活着但不是本服务（陈旧 pid 被复用）：结束不可逆，只提示不动手 */
const warnUnverified = (pid: number | null): void => {
  console.warn(
    `pid ${pid} 未确认是本服务的实例（端口上没有回报同一个 instanceId），跳过结束；` +
      "确认它确实该结束后可手工结束",
  );
};

/** 强杀之后仍在：实例大概处于不可中断状态，端口很可能还被占着，不能报成功 */
const warnLingering = (pid: number | null): void => {
  console.warn(`pid ${pid} 发送了强制结束后仍在，端口可能还被占用，请手工确认`);
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

/**
 * 后台实例要跑的服务入口：就是本 CLI 自己。
 * 全局安装后 `argv[1]` 是 bin 的软链（不带扩展名），要取真身才知道能不能用 node 直接跑；
 * 源码形态（tsx 跑 TypeScript）起不了后台实例——那是开发路径，明说而不是起一个必然失败的子进程。
 */
const entryPathOf = (): string => {
  const entry = process.argv[1];
  let real: string | undefined;
  try {
    real = entry ? realpathSync(entry) : undefined;
  } catch {
    real = undefined;
  }
  if (!real || !/\.(?:js|mjs|cjs)$/.test(real)) {
    return fail(
      "service 子命令要跑构建产物：先 pnpm build，再用 pnpm start / pnpm restart；开发形态请用 pnpm dev",
    );
  }
  return real;
};

// pnpm 会把 `--` 一并传下来（npm 会去掉它）；本 CLI 的位置参数只有命令本身，
// 裸 `--` 一律丢弃，否则 `pnpm start -- service status` 这种写法会直接报「未知参数」
const argv = process.argv.slice(2).filter((arg) => arg !== "--");

/** 未知参数会让 parseArgs 抛错，捕获后给出可读提示而不是裸堆栈 */
const parseValues = (): { options: CliOptions; positionals: string[] } => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: "string" },
        host: { type: "string" },
        open: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (values.help) {
      console.log(HELP);
      process.exit(0);
    }
    if (values.version) {
      console.log(serviceVersion);
      process.exit(0);
    }
    return {
      options: {
        ...(values.port !== undefined ? { port: values.port } : {}),
        ...(values.host !== undefined ? { host: values.host } : {}),
        open: values.open,
      },
      positionals,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

/** 前台启动：监听解析好的端口后再打印地址（端口 0 时才算得出真实端口） */
const runServe = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  if (rest.length > 0) fail(`serve 不接受位置参数：${rest.join(" ")}`);
  if (options.port) process.env.APP_PORT = options.port;
  if (options.host) process.env.APP_HOST = options.host;

  const { env } = await import("./env");
  const { listening } = await import("./main");
  const url = `http://${toUrlHost(env.host)}:${await listening}`;
  console.log(`${brand.name} 已启动：${url}`);
  if (options.open) openBrowser(url);
};

/** 后台实例的启动参数：把解析好的 APP_HOME 显式传给子进程，避免它按自己的 cwd 重新解析 */
const startOptions = (options: CliOptions, home: AppHome): ServiceStartOptions => ({
  servicePath: home.servicePath,
  logPath: resolve(home.appDir, SERVICE_LOG_FILENAME),
  entryPath: entryPathOf(),
  env: { ...process.env, APP_HOME: home.homeDir },
  cwd: process.cwd(),
  ...(options.port ? { port: options.port } : {}),
  ...(options.host ? { host: options.host } : {}),
  onProgress: (message) => console.log(message),
});

/** 首次启动会生成 `service.json`（含登录密码），把密码顺带回显一次省得去翻文件 */
const printFirstRunPassword = (firstRun: boolean, home: AppHome): void => {
  if (!firstRun) return;
  const registration = readServiceRegistration(home.servicePath);
  if (!registration) return;
  console.log(`首次启动登录密码：${registration.password}（也可查看 ${home.servicePath}）`);
};

const exitWithStart = async (
  options: CliOptions,
  restart: boolean,
  firstRun: boolean,
  home: AppHome,
): Promise<never> => {
  const build = startOptions(options, home);
  const { stop, start } = restart
    ? await restartService(build)
    : { stop: null, start: await startService(build) };

  if (stop && !stop.stopped) {
    if (stop.reason === "unverified") warnUnverified(stop.pid);
    else if (stop.reason === "lingering") warnLingering(stop.pid);
  }
  if (!start.started && start.reason === "already-running") {
    console.log(
      `${brand.name} 已在运行：${start.status.url ?? "（未记录端口）"}（pid ${start.status.pid}）`,
    );
    if (options.open && start.status.url) openBrowser(start.status.url);
    process.exit(0);
  }
  if (!start.started) {
    console.error(`${brand.name} 启动失败：${start.message}`);
    process.exit(1);
  }

  const url = start.status.url ?? "（未记录端口）";
  console.log(`已启动：${url}（pid ${start.status.pid}，日志 ${build.logPath}）`);
  printFirstRunPassword(firstRun, home);
  if (options.open) openBrowser(url);
  process.exit(0);
};

const exitWithStatus = async (home: AppHome): Promise<never> => {
  const status = await serviceStatus(home.servicePath);
  if (!status.running) {
    console.log(`${brand.name} 未运行（home ${home.homeDir}）`);
    process.exit(1);
  }
  console.log(`${brand.name} 运行中：${status.url}（pid ${status.pid}，home ${home.homeDir}）`);
  process.exit(0);
};

const exitWithStop = async (home: AppHome): Promise<never> => {
  const result = await stopService({
    servicePath: home.servicePath,
    onProgress: (message) => console.log(message),
  });
  if (result.stopped) {
    console.log(`${brand.name} 已停止（pid ${result.pid}）`);
    process.exit(0);
  }
  if (result.reason === "unverified") {
    warnUnverified(result.pid);
    process.exit(1);
  }
  if (result.reason === "lingering") {
    warnLingering(result.pid);
    process.exit(1);
  }
  console.log(`${brand.name} 未运行（home ${home.homeDir}）`);
  process.exit(0);
};

const runService = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  const [subcommand, ...extra] = rest;
  if (!subcommand) fail("service 需要子命令：start / restart / stop / status");
  if (extra.length > 0) fail(`service ${subcommand} 不接受位置参数：${extra.join(" ")}`);

  const home = loadAppHome();
  switch (subcommand) {
    case "start":
      await exitWithStart(options, false, !readServiceRegistration(home.servicePath), home);
      return;
    case "restart":
      await exitWithStart(options, true, false, home);
      return;
    case "stop":
      await exitWithStop(home);
      return;
    case "status":
      await exitWithStatus(home);
      return;
    default:
      fail(`未知子命令：service ${subcommand}`);
  }
};

const { options, positionals } = parseValues();
const [command = "serve", ...rest] = positionals;

// 默认走生产形态：跳过 pino-pretty（仅开发用），并选定要加载的环境文件名（.env.prod）；
// 必须在任何 env / app-home 导入之前定下，两个入口共用这一份判断
process.env.NODE_ENV ??= "production";

if (command === "serve") await runServe(rest, options);
else if (command === "service") await runService(rest, options);
else fail(`未知命令：${command}`);
