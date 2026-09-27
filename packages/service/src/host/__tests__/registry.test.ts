import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_FORMAT_VERSION, type ServicePaths, servicePaths } from "../../paths.ts";
import {
  acquireInstanceLock,
  clearRegistration,
  findLiveService,
  isProcessAlive,
  readLiveRegistration,
  readRegistration,
  ServiceConflictError,
  type ServiceRegistration,
  stopService,
  writeRegistration,
} from "../registry.ts";

const created: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((done) => {
      server.close(() => done());
    });
  }
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempPaths(): Promise<ServicePaths> {
  const dir = await mkdtemp(join(tmpdir(), "svc-"));
  created.push(dir);
  const paths = servicePaths(dir);
  if (paths.socket === undefined) throw new Error(`临时目录太深，放不下 unix socket：${dir}`);
  return paths;
}

/** 起一个真的 unix socket 当"活着的端点"——否则任何注册表都会在端点探测这一关被判死。 */
async function listenOn(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true });
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(socketPath, () => done());
  });
}

function makeRegistration(
  paths: ServicePaths,
  overrides: Partial<ServiceRegistration> = {},
): ServiceRegistration {
  return {
    pid: process.pid,
    serviceId: "test-service",
    dataVersion: DATA_FORMAT_VERSION,
    dataDir: paths.dataDir,
    startedAt: new Date().toISOString(),
    endpoints: paths.socket === undefined ? {} : { unix: paths.socket },
    logFile: paths.log,
    version: "0.0.0",
    ...overrides,
  };
}

/** 拿一个确定已经退出的 pid：pid 复用在一个测试进程的生命周期内不会发生。 */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise<void>((done) => {
    child.once("exit", () => done());
  });
  if (pid === undefined) throw new Error("拿不到子进程 pid");
  return pid;
}

async function writeLock(paths: ServicePaths, pid: number, at: string): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(paths.lock, JSON.stringify({ pid, at }), "utf8");
}

describe("readRegistration", () => {
  it("写进去的注册表能原样读回", async () => {
    const paths = await tempPaths();
    const registration = makeRegistration(paths);
    await writeRegistration(paths, registration);
    expect(await readRegistration(paths)).toEqual(registration);
  });

  it("没有注册文件时当作没有服务", async () => {
    expect(await readRegistration(await tempPaths())).toBeUndefined();
  });

  it("注册文件损坏时当作没有服务", async () => {
    const paths = await tempPaths();
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeFile(paths.registry, "{ 这不是 JSON", "utf8");
    expect(await readRegistration(paths)).toBeUndefined();
  });

  it("缺必要字段时当作没有服务", async () => {
    const paths = await tempPaths();
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeFile(paths.registry, JSON.stringify({ dataDir: paths.dataDir }), "utf8");
    expect(await readRegistration(paths)).toBeUndefined();
  });
});

describe("clearRegistration", () => {
  it("清掉之后就当作没有服务", async () => {
    const paths = await tempPaths();
    await writeRegistration(paths, makeRegistration(paths));
    await clearRegistration(paths);
    expect(await readRegistration(paths)).toBeUndefined();
  });

  it("本来就没有注册文件时不报错", async () => {
    await expect(clearRegistration(await tempPaths())).resolves.toBeUndefined();
  });
});

describe("isProcessAlive", () => {
  it("当前进程判定为活着", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("已经退出的进程判定为死", async () => {
    expect(isProcessAlive(await deadPid())).toBe(false);
  });

  it("非法 pid 一律判死", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });
});

describe("findLiveService", () => {
  it("没有注册表时判定为没有服务", async () => {
    expect(await findLiveService(await tempPaths())).toBeUndefined();
  });

  it("端点能连、但 pid 已死时判定为没有服务（kill -9 的残骸）", async () => {
    const paths = await tempPaths();
    await listenOn(paths.socket as string);
    await writeRegistration(paths, makeRegistration(paths, { pid: await deadPid() }));
    expect(await findLiveService(paths)).toBeUndefined();
  });

  it("pid 活着、但端点探测不通时判定为没有服务", async () => {
    const paths = await tempPaths();
    await writeRegistration(paths, makeRegistration(paths));
    expect(await findLiveService(paths)).toBeUndefined();
  });

  it("pid 与端点都活着时返回注册信息", async () => {
    const paths = await tempPaths();
    await listenOn(paths.socket as string);
    const registration = makeRegistration(paths);
    await writeRegistration(paths, registration);
    const live = await findLiveService(paths);
    expect(live?.registration).toEqual(registration);
    expect(live?.paths.root).toBe(paths.root);
  });

  it("数据格式版本对不上的服务不复用，但仍算活着（不能抢它的锁）", async () => {
    const paths = await tempPaths();
    await listenOn(paths.socket as string);
    await writeRegistration(paths, makeRegistration(paths, { dataVersion: "v0" }));
    expect(await findLiveService(paths)).toBeUndefined();
    expect((await readLiveRegistration(paths))?.dataVersion).toBe("v0");
  });
});

describe("acquireInstanceLock", () => {
  it("第一次取锁成功，释放之后能再取一次", async () => {
    const paths = await tempPaths();
    const release = await acquireInstanceLock(paths);
    await release();
    await expect(acquireInstanceLock(paths)).resolves.toBeTypeOf("function");
  });

  it("已有活服务时抛冲突，并带上是哪个 pid", async () => {
    const paths = await tempPaths();
    await listenOn(paths.socket as string);
    await writeRegistration(paths, makeRegistration(paths));
    const failure = await acquireInstanceLock(paths).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ServiceConflictError);
    expect((failure as ServiceConflictError).pid).toBe(process.pid);
  });

  it("锁被活着的 pid 持有、且还在启动宽限期内时判为冲突（不抢正在启动的服务）", async () => {
    const paths = await tempPaths();
    await writeLock(paths, process.pid, new Date().toISOString());
    await expect(acquireInstanceLock(paths)).rejects.toBeInstanceOf(ServiceConflictError);
  });

  it("锁的 pid 活着但早已超过启动宽限期、端点也不通时窃取（pid 复用或持有者卡死）", async () => {
    const paths = await tempPaths();
    await writeLock(paths, process.pid, new Date(Date.now() - 10 * 60_000).toISOString());
    await expect(acquireInstanceLock(paths)).resolves.toBeTypeOf("function");
  });

  it("锁里的 pid 已死时窃取（服务已经不在了）", async () => {
    const paths = await tempPaths();
    await writeLock(paths, await deadPid(), new Date().toISOString());
    await expect(acquireInstanceLock(paths)).resolves.toBeTypeOf("function");
  });

  it("陈旧锁 + 陈旧注册表（pid 活但端点不通）时也能窃取", async () => {
    const paths = await tempPaths();
    await writeLock(paths, process.pid, new Date(Date.now() - 10 * 60_000).toISOString());
    await writeRegistration(paths, makeRegistration(paths));
    await expect(acquireInstanceLock(paths)).resolves.toBeTypeOf("function");
  });

  it("释放只删自己写的那把锁（锁被别人窃取过时不替对方清场）", async () => {
    const paths = await tempPaths();
    const release = await acquireInstanceLock(paths);
    await writeLock(paths, await deadPid(), new Date().toISOString());
    await release();
    await expect(readFile(paths.lock, "utf8")).resolves.toContain("pid");
  });
});

describe("stopService", () => {
  it("进程已经不在时直接返回成功", async () => {
    const paths = await tempPaths();
    const registration = makeRegistration(paths, { pid: await deadPid() });
    await expect(stopService(registration, 500)).resolves.toBe(true);
  });
});
