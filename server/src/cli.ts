/**
 * 命令行入口：解析命令与参数，前台启动交给 `main`，实例生命周期交给 `services/service-control`，
 * 其余子命令（logs / open / doctor / password / update / completion / help）在 `services/cli`。
 *
 * 前台启动是主路径：`pnpm start` 跑的就是本文件经 esbuild 打成的 `dist/` 产物（npm 安装后 `bin` 也指向它），
 * 开发走 `server/src/main.ts`（tsx watch），不经这里。
 * `start` 起的是同一个产物的后台实例，只是脱离终端、输出进 `$APP_HOME/app/service.log`；
 * 服务的生命周期由显式命令控制，不用 watch 重启打断正在进行的会话（见 README「生产启动与自迭代」）。
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { brand } from "@ucode/brand/values";

import { SERVICE_LOG_FILENAME } from "./constants/dirs";
import { type AppHome, loadAppHome } from "./platform/app-home";
import { readInstanceVersion } from "./platform/instance";
import { followLog, readServiceLogTail } from "./platform/service-log";
import { readServiceRegistration, toUrlHost } from "./platform/service-registration";
import { minNodeMajor, serviceVersion } from "./platform/version";
import {
  CLI_OPTIONS,
  type CliCommand,
  checkForUpdate,
  findCommand,
  findOption,
  isCompletionShell,
  renderCommandHelp,
  renderCompletion,
  renderDoctor,
  renderDoctorJson,
  renderOverview,
  renderUpdate,
  renderUpdateJson,
  runDoctor,
} from "./services/cli";
import {
  restartService,
  type ServiceStartOptions,
  serviceStatus,
  startService,
  stopService,
} from "./services/service-control";

/** `logs` 默认打印的行数：出问题时先看最近一段，不够再 `-n` 加 */
const DEFAULT_LOG_LINES = 200;

/**
 * Node 版本先验：会话数据库依赖 `node:sqlite`，版本不够时在动态导入 env / main 之前给一句人话。
 * 静态导入的模块都不碰它，所以这条判断跑得到。
 */
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (minNodeMajor !== null && nodeMajor < minNodeMajor) {
  console.error(`${brand.name} 需要 Node ≥ ${minNodeMajor}（当前 ${process.versions.node}）`);
  process.exit(1);
}

type CliOptions = {
  port?: string;
  host?: string;
  open: boolean;
  json: boolean;
  lines?: string;
  follow: boolean;
};

/** 错误提示统一带上帮助：子命令写法不对时，光看一行报错还得再翻一次文档 */
const fail: (message: string) => never = (message) => {
  console.error(message);
  console.error(`\n${renderOverview()}`);
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

/**
 * 打开浏览器：只有子进程真的起来了才算成功。
 * `spawn` 的失败是异步事件，调用方必须等结果再报「已打开」并退出——否则缺 `xdg-open` 时
error 处理器根本跑不到，成功提示是假的。
 */
const openBrowser = (url: string): Promise<boolean> => {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => {
      console.warn(`打开浏览器失败，请手动访问 ${url}`);
      resolve(false);
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
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
      "后台实例要跑构建产物：先 pnpm build，再用 pnpm start / pnpm restart；开发形态请用 pnpm dev",
    );
  }
  return real;
};

// pnpm 会把 `--` 一并传下来（npm 会去掉它）；本 CLI 的位置参数只有命令本身，
// 裸 `--` 一律丢弃，否则 `pnpm start -- service status` 这种写法会直接报「未知参数」。
// `-V` 与 `-v` 同义：parseArgs 每个选项只收一个短写法，多出来的在这里归一化
const argv = process.argv
  .slice(2)
  .filter((arg) => arg !== "--")
  .map((arg) => (arg === "-V" ? "--version" : arg));

/** parseArgs 的选项表由命令表生成：加一个选项只改 `services/cli/spec` */
const PARSE_OPTIONS = {
  ...Object.fromEntries(
    CLI_OPTIONS.map((option) => [
      option.long,
      option.type === "string"
        ? { type: "string" as const, ...(option.short ? { short: option.short } : {}) }
        : { type: "boolean" as const, ...(option.short ? { short: option.short } : {}) },
    ]),
  ),
  version: { type: "boolean" as const, short: "v" },
  help: { type: "boolean" as const, short: "h" },
};

type ParsedArgs = {
  /** 只含命令行里真的给出的选项（不设默认值），白名单校验据此判断 */
  values: Record<string, string | boolean>;
  positionals: string[];
};

/** `--help` 跟在哪个命令后面就打印哪个命令的帮助；没有命令时是总览 */
const printHelp = (positionals: readonly string[]): void => {
  const [command, subcommand] = positionals;
  const target = command === "service" && subcommand ? subcommand : command;
  const text = target ? renderCommandHelp(target) : undefined;
  console.log(text ?? renderOverview());
};

/** 未知参数会让 parseArgs 抛错，捕获后给出可读提示而不是裸堆栈 */
const parseValues = (): ParsedArgs => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: PARSE_OPTIONS,
    });
    if (values.help) {
      printHelp(positionals);
      process.exit(0);
    }
    if (values.version) {
      console.log(serviceVersion);
      process.exit(0);
    }
    return { values, positionals };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

/** 生效的命令：`service start` 按 `start` 的选项集校验，子命令写错时退回 `service` 自己 */
const leafCommand = (command: string, rest: readonly string[]): CliCommand | undefined => {
  if (command !== "service") return findCommand(command);
  const parent = findCommand("service");
  const subcommand = rest[0];
  const known = parent?.values ?? [];
  return subcommand && known.includes(subcommand) ? findCommand(subcommand) : parent;
};

/** 选项按生效命令白名单校验：`logs --port` 报错，而不是静默接受 */
const assertOptions = (leaf: CliCommand | undefined, provided: readonly string[]): void => {
  if (!leaf) return;
  const allowed = new Set(leaf.options.map((name) => findOption(name).long));
  for (const name of provided) {
    if (name === "version" || name === "help") continue;
    if (!allowed.has(name)) fail(`${leaf.name} 不接受 --${name}`);
  }
};

const toOptions = (values: Record<string, string | boolean>): CliOptions => ({
  ...(typeof values.port === "string" ? { port: values.port } : {}),
  ...(typeof values.host === "string" ? { host: values.host } : {}),
  open: values.open === true,
  json: values.json === true,
  ...(typeof values.lines === "string" ? { lines: values.lines } : {}),
  follow: values.follow === true,
});

/** 前台启动：监听解析好的端口后再打印地址（端口 0 时才算得出真实端口） */
const runServe = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  if (rest.length > 0) fail(`serve 不接受位置参数：${rest.join(" ")}`);
  if (options.port) process.env.APP_PORT = options.port;
  if (options.host) process.env.APP_HOST = options.host;

  const { env } = await import("./env");
  const { listening } = await import("./main");
  const url = `http://${toUrlHost(env.host)}:${await listening}`;
  console.log(`${brand.name} 已启动：${url}`);
  if (options.open) await openBrowser(url);
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
  console.log(
    `首次启动登录密码：${registration.password}（也可查看 ${home.servicePath}，或执行 ${brand.slug} password）`,
  );
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
    if (options.open && start.status.url) await openBrowser(start.status.url);
    process.exit(0);
  }
  if (!start.started) {
    console.error(`${brand.name} 启动失败：${start.message}`);
    process.exit(1);
  }

  const url = start.status.url ?? "（未记录端口）";
  console.log(`已启动：${url}（pid ${start.status.pid}，日志 ${build.logPath}）`);
  printFirstRunPassword(firstRun, home);
  if (options.open) await openBrowser(url);
  process.exit(0);
};

/** 实例版本与本机 CLI 不一致时单独提一行：升级后忘了 restart 是最常见的「怎么还是老界面」 */
const printVersionNote = (version: string | null): void => {
  if (!version || version === serviceVersion) return;
  console.log(
    `实例版本 ${version} 与本机 CLI ${serviceVersion} 不一致：${brand.slug} restart 后切换`,
  );
};

const exitWithStatus = async (home: AppHome, json: boolean): Promise<never> => {
  const status = await serviceStatus(home.servicePath);
  const version = status.running && status.url ? await readInstanceVersion(status.url) : null;

  if (json) {
    console.log(
      JSON.stringify(
        {
          running: status.running,
          url: status.url,
          pid: status.pid,
          host: status.host,
          port: status.port,
          home: home.homeDir,
          cliVersion: serviceVersion,
          version,
        },
        null,
        2,
      ),
    );
    process.exit(status.running ? 0 : 1);
  }

  if (!status.running) {
    console.log(`${brand.name} 未运行（home ${home.homeDir}）`);
    process.exit(1);
  }
  console.log(
    `${brand.name} 运行中：${status.url}（pid ${status.pid}${version ? `，版本 ${version}` : ""}，home ${home.homeDir}）`,
  );
  printVersionNote(version);
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

/** start / restart / stop / status：顶层快捷命令与 `service <子命令>` 落到同一处 */
const runServiceAction = async (action: string, options: CliOptions): Promise<void> => {
  const home = loadAppHome();
  switch (action) {
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
      await exitWithStatus(home, options.json);
      return;
    default:
      fail(`未知子命令：service ${action}`);
  }
};

const runService = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  const [subcommand, ...extra] = rest;
  if (!subcommand) fail("service 需要子命令：start / restart / stop / status");
  if (extra.length > 0) fail(`service ${subcommand} 不接受位置参数：${extra.join(" ")}`);
  await runServiceAction(subcommand, options);
};

const parseLines = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_LOG_LINES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`--lines 需要正整数：${raw}`);
  return value;
};

/**
 * 打印日志：不用 `process.exit` 收尾。stdout 是管道时写入是异步的，
 * 退出得比写完早会把 64KB 之后的内容静默丢掉（`logs | grep` 就看不全）；
 * 设 `exitCode` 后返回，让事件循环把输出排干。
 */
const runLogs = (rest: readonly string[], options: CliOptions): void => {
  if (rest.length > 0) fail(`logs 不接受位置参数：${rest.join(" ")}`);
  const home = loadAppHome();
  const logPath = resolve(home.appDir, SERVICE_LOG_FILENAME);
  const tail = readServiceLogTail(logPath, { lines: parseLines(options.lines) });
  if (tail.text) console.log(tail.text);

  if (!options.follow) {
    if (!tail.text) {
      console.error(`没有日志：${logPath}（${brand.slug} start 之后才有）`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  // 从 tail 读完的位置续读：两段之间新写入的行不会漏
  const follow = followLog(logPath, {
    resume: tail.resume,
    onChunk: (text) => process.stdout.write(text),
    onError: (message) => console.error(`读取日志出错：${message}`),
  });
  // Ctrl-C 是退出跟随的正常方式：停掉轮询后让事件循环自然结束，不留下未处理的信号
  process.on("SIGINT", () => {
    follow.stop();
    process.exitCode = 0;
  });
};

const runOpen = async (rest: readonly string[], _options: CliOptions): Promise<void> => {
  if (rest.length > 0) fail(`open 不接受位置参数：${rest.join(" ")}`);
  const home = loadAppHome();
  const status = await serviceStatus(home.servicePath);
  if (!status.running || !status.url) {
    console.error(`${brand.name} 未运行：先执行 ${brand.slug} start`);
    process.exitCode = 1;
    return;
  }
  // 子进程起不来时 `openBrowser` 已经给出提示，这里不能先报「已打开」
  if (!(await openBrowser(status.url))) {
    process.exitCode = 1;
    return;
  }
  console.log(`已在浏览器打开 ${status.url}`);
  process.exitCode = 0;
};

const runPassword = (rest: readonly string[], _options: CliOptions): void => {
  if (rest.length > 0) fail(`password 不接受位置参数：${rest.join(" ")}`);
  const home = loadAppHome();
  const registration = readServiceRegistration(home.servicePath);
  if (!registration) {
    console.error(`还没有注册文件：${home.servicePath}（${brand.slug} start 首次启动时生成）`);
    process.exit(1);
  }
  console.log(`登录密码：${registration.password}`);
  console.log(`注册文件：${home.servicePath}（含 serviceToken，权限仅属主可读）`);
  process.exit(0);
};

const runUpdate = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  if (rest.length > 0) fail(`update 不接受位置参数：${rest.join(" ")}`);
  const check = await checkForUpdate();
  console.log(options.json ? renderUpdateJson(check) : renderUpdate(check));
  process.exit(check.error ? 1 : 0);
};

const runDoctorCommand = async (rest: readonly string[], options: CliOptions): Promise<void> => {
  if (rest.length > 0) fail(`doctor 不接受位置参数：${rest.join(" ")}`);
  const report = await runDoctor();
  console.log(options.json ? renderDoctorJson(report) : renderDoctor(report));
  process.exit(report.hasFailure ? 1 : 0);
};

const runCompletion = (rest: readonly string[], _options: CliOptions): void => {
  const [shell, ...extra] = rest;
  if (!shell) fail("completion 需要指定 shell：bash / zsh / fish");
  if (extra.length > 0) fail(`completion 只接受一个 shell：${extra.join(" ")}`);
  const script = isCompletionShell(shell) ? renderCompletion(shell) : undefined;
  if (!script) fail(`未知 shell：${shell}（可选 bash / zsh / fish）`);
  console.log(script);
};

const runHelp = (rest: readonly string[], _options: CliOptions): void => {
  const [name, ...extra] = rest;
  if (!name) {
    console.log(renderOverview());
    return;
  }
  if (extra.length > 0) fail(`help 只接受一个命令名：${extra.join(" ")}`);
  const text = renderCommandHelp(name);
  if (!text) fail(`未知命令：${name}`);
  console.log(text);
};

const { values, positionals } = parseValues();
const [command = "serve", ...rest] = positionals;

const options = toOptions(values);
assertOptions(leafCommand(command, rest), Object.keys(values));

// 默认走生产形态：跳过 pino-pretty（仅开发用），并选定要加载的环境文件名（.env.prod）；
// 必须在任何 env / app-home 导入之前定下，两个入口共用这一份判断
process.env.NODE_ENV ??= "production";

if (command === "serve") await runServe(rest, options);
else if (
  command === "start" ||
  command === "restart" ||
  command === "stop" ||
  command === "status"
) {
  if (rest.length > 0) fail(`${command} 不接受位置参数：${rest.join(" ")}`);
  await runServiceAction(command, options);
} else if (command === "service") await runService(rest, options);
else if (command === "logs") runLogs(rest, options);
else if (command === "open") await runOpen(rest, options);
else if (command === "doctor") await runDoctorCommand(rest, options);
else if (command === "password") runPassword(rest, options);
else if (command === "update") await runUpdate(rest, options);
else if (command === "completion") runCompletion(rest, options);
else if (command === "help") runHelp(rest, options);
else if (command === "version") console.log(serviceVersion);
else fail(`未知命令：${command}`);
