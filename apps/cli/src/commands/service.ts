import { chmod, mkdir, readFile, unlink } from "node:fs/promises";
import { getBrand } from "@ucode/branding";
import type { TransportBinding } from "@ucode/protocol";
import { connect } from "@ucode/sdk";
import { createClient as createRpcClient } from "@ucode/sdk/rpc";
import {
  acquireInstanceLock,
  clearRegistration,
  createHttpBinding,
  createRpcBinding,
  createService,
  createStdioBinding,
  ensureService,
  findLiveService,
  isProcessAlive,
  readRegistration,
  servicePaths,
  stopService,
  writeRegistration,
} from "@ucode/service";
import cliManifest from "../../package.json" with { type: "json" };
import type { ServiceLogsOptions, ServiceStartOptions } from "../options.ts";
import { log, waitForShutdown } from "../runtime.ts";
import { serviceCommand } from "../service-command.ts";
import { resolveWebAssets } from "../web-assets.ts";

/**
 * `service` —— 常驻的唯一后端（BS 架构的服务端）。
 *
 * ```
 *   Web 浏览器 ──环回 HTTP（顺带发静态资源）──┐
 *   TUI        ──unix socket─────────────────┤── service ── pi 会话 + SQLite
 *   脚本/CLI    ──unix socket─────────────────┘
 * ```
 *
 * 壳不各自拉起后端：它们 `ensureService`（发现 → 连上，没有就拉起）。
 * 一个数据根一个服务，靠运行时目录里的实例锁保证。
 */

export async function runServiceStart(options: ServiceStartOptions): Promise<number> {
  // 不带 --foreground：把自己 detach 出去，等它就绪后返回（壳走的就是这条）。
  if (!options.foreground) return startDetached(options);
  return runForeground(options);
}

async function startDetached(options: ServiceStartOptions): Promise<number> {
  const live = await ensureService({
    paths: servicePaths(options.dataDir),
    command: serviceCommand({
      root: options.dataDir,
      cwd: options.cwd,
      host: options.host,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
      ...(options.noHttp ? { noHttp: true } : {}),
    }),
  });
  reportEndpoints(live.registration, "服务就绪");
  return 0;
}

/** 前台形态：detached 子进程跑的就是它，也用于调试（Ctrl-C 即停）。 */
async function runForeground(options: ServiceStartOptions): Promise<number> {
  if (options.stdio) return runEmbeddedStdio(options);
  const paths = servicePaths(options.dataDir);
  const releaseLock = await acquireInstanceLock(paths);

  let service: Awaited<ReturnType<typeof createService>> | undefined;
  const bindings: TransportBinding[] = [];
  try {
    service = await createService({
      dataDir: options.dataDir,
      cwd: options.cwd,
      defaultAutonomy: options.autonomy,
    });

    await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
    // 上次可能是被 kill -9 的：陈旧 socket 文件会让 listen 直接失败（EADDRINUSE）。
    if (paths.socket !== undefined) await unlink(paths.socket).catch(() => undefined);

    const rpc =
      paths.socket === undefined
        ? undefined
        : createRpcBinding(service, { socketPath: paths.socket });
    if (rpc !== undefined) {
      await rpc.start();
      bindings.push(rpc);
      // unix socket 的 connect 权限由文件的写位决定；内核按 umask 建它，这里收紧到 0600，
      // 让"同机其他用户连不上"不依赖 umask 的取值。
      if (paths.socket !== undefined) await chmod(paths.socket, 0o600).catch(() => undefined);
    }

    // 静态资源缺失不是错误：服务只是少一条"浏览器直接打开"的通路。
    let staticDir: string | undefined;
    try {
      staticDir = await resolveWebAssets(options.webAssets);
    } catch (error) {
      log(
        `Web 壳静态资源不可用（${error instanceof Error ? error.message : String(error)}）：` +
          "本次只提供协议端点，浏览器打不开界面。",
      );
    }

    // `--no-http`：只留 unix socket。环回端口对本机任意进程开放，不需要浏览器时关掉它更干净。
    const http = options.noHttp
      ? undefined
      : createHttpBinding(service, {
          host: options.host,
          ...(options.port === undefined ? {} : { port: options.port }),
          ...(staticDir === undefined ? {} : { staticDir }),
          ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
        });
    if (http !== undefined) {
      await http.start();
      bindings.push(http);
    }
    if (rpc === undefined && http === undefined) {
      throw new Error("既没有 unix socket 也没有 HTTP 绑定：无法为任何客户端提供服务。");
    }

    const registration = {
      pid: process.pid,
      serviceId: service.coreId,
      dataVersion: paths.dataDir.slice(paths.root.length + 1),
      dataDir: paths.dataDir,
      startedAt: new Date().toISOString(),
      endpoints: {
        ...(rpc === undefined ? {} : { unix: paths.socket }),
        ...(http === undefined ? {} : { http: http.endpoint }),
      },
      logFile: paths.log,
      version: cliManifest.version,
    };
    await writeRegistration(paths, registration);
    log(
      `服务就绪：pid=${registration.pid} serviceId=${registration.serviceId} 数据根=${paths.root}`,
    );
    reportEndpoints(registration, "服务端点");

    await waitForShutdown();
    log("收到退出信号：关闭会话运行时与传输……");
  } finally {
    for (const binding of bindings) await binding.stop().catch(() => undefined);
    await service?.close().catch(() => undefined);
    await clearRegistration(paths);
    await releaseLock();
  }
  return 0;
}

/**
 * 嵌入式形态（`--stdio`）：给**父进程 spawn** 的壳用（桌面壳就是这么起后端的）。
 *
 * 与常驻形态的差别是刻意的：不写注册表、不占实例锁、不开环回端口——
 * 它的生命周期完全由父进程掌握，与"数据根上那个常驻服务"是两回事。
 */
async function runEmbeddedStdio(options: ServiceStartOptions): Promise<number> {
  const service = await createService({
    dataDir: options.dataDir,
    cwd: options.cwd,
    defaultAutonomy: options.autonomy,
  });
  const stdio = createStdioBinding(service);
  try {
    await stdio.start();
    log("服务就绪：stdio（嵌入式，父进程持有生命周期）");
    await waitForShutdown();
  } finally {
    await stdio.stop().catch(() => undefined);
    await service.close().catch(() => undefined);
  }
  return 0;
}

export async function runServiceStatus(options: { dataDir: string }): Promise<number> {
  const live = await findLiveService(servicePaths(options.dataDir));
  if (live === undefined) {
    log("服务未运行。");
    log(`  数据根：${options.dataDir}`);
    const name = getBrand().productName;
    log(`  启动：${name} service start（或直接跑 ${name} web / ${name} tui，壳会自动拉起）`);
    return 1;
  }
  const { registration, paths } = live;
  log("服务运行中。");
  log(`  pid：${registration.pid}`);
  log(`  serviceId：${registration.serviceId}`);
  log(`  数据根：${paths.root}`);
  log(`  数据格式：${registration.dataVersion}`);
  log(`  启动于：${registration.startedAt}`);
  reportEndpoints(registration, "端点");

  const count = await sessionCount(registration).catch(() => undefined);
  log(`  会话数：${count === undefined ? "（查询失败）" : String(count)}`);
  return 0;
}

export async function runServiceStop(options: { dataDir: string }): Promise<number> {
  const paths = servicePaths(options.dataDir);
  const registration = await readRegistration(paths);
  if (registration === undefined) {
    log("服务未运行（没有注册文件）。");
    return 0;
  }
  if (!isProcessAlive(registration.pid)) {
    await clearRegistration(paths);
    await unlink(paths.lock).catch(() => undefined);
    log(`服务进程已不在（pid=${registration.pid}），已清理陈旧状态。`);
    return 0;
  }
  log(`正在停止服务（pid=${registration.pid}）……`);
  const stopped = await stopService(registration);
  if (!stopped) {
    log(`服务在超时内未退出（pid=${registration.pid}）。可再试，或直接 kill 它。`);
    return 1;
  }
  await clearRegistration(paths);
  log("服务已停止。");
  return 0;
}

export async function runServiceLogs(options: ServiceLogsOptions): Promise<number> {
  const paths = servicePaths(options.dataDir);
  let offset = 0;
  try {
    const content = await readFile(paths.log, "utf8");
    process.stderr.write(content);
    offset = Buffer.byteLength(content, "utf8");
  } catch {
    log(`没有日志文件（${paths.log}）。`);
    if (!options.follow) return 1;
  }
  if (!options.follow) return 0;

  log(`……跟踪日志（Ctrl-C 退出）：${paths.log}`);
  for (;;) {
    await new Promise((done) => setTimeout(done, 300));
    try {
      const content = await readFile(paths.log, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > offset) {
        process.stderr.write(Buffer.from(content, "utf8").subarray(offset).toString("utf8"));
        offset = bytes;
      } else if (bytes < offset) {
        offset = 0; // 日志被轮转或清空
      }
    } catch {
      // 文件暂时不可读：下一次再试
    }
  }
}

/** 通过协议问一次会话数——顺带证明这个端点真的能用，而不只是端口开着。 */
async function sessionCount(registration: {
  endpoints: { unix?: string; http?: string };
}): Promise<number> {
  const transport =
    registration.endpoints.unix !== undefined
      ? createRpcClient({ socketPath: registration.endpoints.unix })
      : createRpcClient({ host: "127.0.0.1", port: portOf(registration.endpoints.http) });
  const sdk = await connect({
    transport,
    clientKind: "cli",
    capabilities: ["sessions.read"],
  });
  try {
    await sdk.connect();
    const sessions = await sdk.listSessions();
    return sessions.length;
  } finally {
    await sdk.close().catch(() => undefined);
  }
}

function portOf(http: string | undefined): number {
  if (http === undefined) return 0;
  const match = /:(\d+)$/u.exec(http);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function reportEndpoints(
  registration: { endpoints: { unix?: string; http?: string }; logFile: string },
  title: string,
): void {
  log(`${title}：`);
  if (registration.endpoints.unix !== undefined) {
    log(`  unix：${registration.endpoints.unix}（TUI / 脚本）`);
  }
  if (registration.endpoints.http !== undefined) {
    log(`  http：${registration.endpoints.http}（浏览器直接打开）`);
  }
  log(`  日志：${registration.logFile}`);
}
