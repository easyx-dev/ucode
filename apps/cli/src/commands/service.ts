import { chmod, mkdir, readFile, unlink } from "node:fs/promises";
import { createBinding as createHttpBinding } from "@ucode/binding-http";
import { createBinding as createRpcBinding } from "@ucode/binding-rpc";
import { getBrand } from "@ucode/branding";
import { createCore } from "@ucode/core";
import type { TransportBinding } from "@ucode/protocol";
import { connect } from "@ucode/sdk";
import { createClient as createRpcClient } from "@ucode/sdk/rpc";
import cliManifest from "../../package.json" with { type: "json" };
import type { ServiceLogsOptions, ServiceStartOptions } from "../options.ts";
import { log, waitForShutdown } from "../runtime.ts";
import {
  acquireServiceLock,
  clearRegistration,
  ensureService,
  findLiveService,
  isProcessAlive,
  readRegistration,
  servicePaths,
  stopService,
  writeRegistration,
} from "../service-registry.ts";
import { resolveWebAssets } from "../web-assets.ts";

/**
 * `service` —— 常驻的唯一后端（BS 架构的服务端）。
 *
 * ```
 *   Web 浏览器 ──HTTP/SSE──┐
 *   TUI        ──unix──────┤── service ── pi 会话
 *   脚本/CLI    ──unix──────┘
 * ```
 *
 * 壳不再各自拉起核心层：它们 `ensureService`（发现→连上，没有就拉起），
 * 于是"一个对话，多端同看同写"成立，也不再出现"孤儿核心层占着 owner 租约"。
 *
 * 服务同时监听两条通路：unix socket（壳用，受文件权限约束）与环回 HTTP（浏览器用，
 * 顺带把 Web 壳的静态资源发出去，于是浏览器与服务同源、没有 CORS）。
 */

export async function runServiceStart(options: ServiceStartOptions): Promise<number> {
  // 不带 --foreground：把自己 detach 出去，等它就绪后返回（壳走的就是这条）。
  if (!options.foreground) return startDetached(options);
  return runForeground(options);
}

async function startDetached(options: ServiceStartOptions): Promise<number> {
  const live = await ensureService({
    dataDir: options.dataDir,
    cwd: options.cwd,
    host: options.host,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
    ...(options.noHttp ? { noHttp: true } : {}),
  });
  reportEndpoints(live.registration, "服务就绪");
  return 0;
}

/** 前台形态：detached 子进程跑的就是它，也用于调试（Ctrl-C 即停）。 */
async function runForeground(options: ServiceStartOptions): Promise<number> {
  const paths = servicePaths(options.dataDir);
  const releaseLock = await acquireServiceLock(paths, options.dataDir);

  let core: Awaited<ReturnType<typeof createCore>> | undefined;
  const bindings: TransportBinding[] = [];
  try {
    core = await createCore({
      dataDir: options.dataDir,
      cwd: options.cwd,
      defaultAutonomy: options.autonomy,
    });

    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    // 上次可能是被 kill -9 的：陈旧 socket 文件会让 listen 直接失败（EADDRINUSE）。
    if (paths.socket !== undefined) await unlink(paths.socket).catch(() => undefined);

    const rpc =
      paths.socket === undefined ? undefined : createRpcBinding(core, { socketPath: paths.socket });
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
      staticDir = await resolveWebAssets();
    } catch (error) {
      log(
        `Web 壳静态资源不可用（${error instanceof Error ? error.message : String(error)}）：` +
          "本次只提供协议端点，浏览器打不开界面。",
      );
    }

    // `--no-http`：只留 unix socket。环回端口对本机任意进程开放，不需要浏览器时关掉它更干净。
    const http = options.noHttp
      ? undefined
      : createHttpBinding(core, {
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
      coreId: core.coreId,
      dataDir: core.dataDir,
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
      `服务就绪：pid=${registration.pid} coreId=${registration.coreId} 数据层=${registration.dataDir}`,
    );
    reportEndpoints(registration, "服务端点");

    await waitForShutdown();
    log("收到退出信号：释放 owner 租约并关闭会话运行时……");
  } finally {
    for (const binding of bindings) await binding.stop().catch(() => undefined);
    await core?.close().catch(() => undefined);
    await clearRegistration(paths);
    await releaseLock();
  }
  return 0;
}

export async function runServiceStatus(options: { dataDir: string }): Promise<number> {
  const live = await findLiveService(options.dataDir);
  if (live === undefined) {
    log("服务未运行。");
    log(`  数据层：${options.dataDir}`);
    const name = getBrand().productName;
    log(`  启动：${name} service start（或直接跑 ${name} web / ${name} tui，壳会自动拉起）`);
    return 1;
  }
  const { registration } = live;
  log("服务运行中。");
  log(`  pid：${registration.pid}`);
  log(`  coreId：${registration.coreId}`);
  log(`  数据层：${registration.dataDir}`);
  log(`  启动于：${registration.startedAt}`);
  reportEndpoints(registration, "端点");

  const count = await sessionCount(live.registration).catch(() => undefined);
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
