/**
 * 后台服务观测单测：端口线索提取 + 「执行前后翻转」的命中判定 + 异常路径也结算。
 *
 * 判定本身就是「能不能连上」，所以探测走真实回环连接，用例自己起 `node:net` 服务当被观测对象。
 */
import assert from "node:assert/strict";
import { type AddressInfo, createServer } from "node:net";
import { describe, it } from "node:test";

import type { BashOperations } from "@earendil-works/pi-coding-agent";

import {
  isLoopbackHost,
  portsFromCommand,
  portsFromOutput,
  type ServiceObservation,
  withServiceWatch,
} from "../services";

/** 借一个空闲端口：先 listen(0) 拿到号再关掉，用例用它当「命令要占的端口」 */
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

/** 占用指定端口，返回关闭函数 */
const listen = async (port: number): Promise<() => Promise<void>> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 结算在后台推进（fire-and-forget），等它落地再断言 */
const waitForObservation = async (observed: ServiceObservation[]): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (observed.length === 0 && Date.now() < deadline) await delay(20);
};

const collector = (): {
  observed: ServiceObservation[];
  hooks: { observe: (o: ServiceObservation) => void };
} => {
  const observed: ServiceObservation[] = [];
  return { observed, hooks: { observe: (observation) => observed.push(observation) } };
};

const noop: BashOperations = { exec: async () => ({ exitCode: 0 }) };

describe("后台服务观测 · 端口线索", () => {
  it("命令里认显式端口参数与写出来的回环地址", () => {
    assert.deepEqual(portsFromCommand("pnpm dev --port 5173"), [5173]);
    assert.deepEqual(portsFromCommand("vite --port=5174 --host 0.0.0.0"), [5174]);
    assert.deepEqual(portsFromCommand("PORT=3000 node server.js"), [3000]);
    assert.deepEqual(portsFromCommand("curl http://localhost:8080/health"), [8080]);
  });

  it("端口作为位置参数时按独立数字认出来", () => {
    // 实战命中：`nohup python3 -m http.server 45678 ... &` 这类命令的端口既不是参数也不是地址
    assert.deepEqual(portsFromCommand("python3 -m http.server 45678"), [45678]);
    assert.deepEqual(portsFromCommand("next dev -p 3000"), [3000]);
    // 放宽的代价只是多探几个端口：短数字与越界的都不算，记一条仍要过「前后翻转」
    assert.deepEqual(portsFromCommand("--max-time 5 --retry 3 curl x"), []);
    assert.deepEqual(portsFromCommand("sleep 900"), []);
    assert.deepEqual(portsFromCommand("echo 99999"), []);
  });

  it("只收回环：域名、局域网 IP 与正文里的数字都不是端口", () => {
    assert.deepEqual(portsFromCommand("curl http://example.com:8443/api"), []);
    assert.deepEqual(portsFromCommand("echo '12:30 出发'"), []);
    assert.deepEqual(portsFromCommand("node -e \"console.log('a:b')\""), []);
    assert.deepEqual(portsFromCommand("curl http://192.168.1.5:8080/x"), []);
  });

  it("输出里认服务自己打印的地址", () => {
    assert.deepEqual(portsFromOutput("  Local:   http://localhost:5173/"), [5173]);
    assert.deepEqual(portsFromOutput("  ➜  Local:   http://127.0.0.1:5173/"), [5173]);
    assert.deepEqual(portsFromOutput("Listening on 0.0.0.0:3000"), [3000]);
    assert.deepEqual(portsFromOutput("ready in 200 ms, port 8080"), [8080]);
    assert.deepEqual(portsFromOutput("done in 1.2s"), []);
  });

  it("重复端口去重，回环主机覆盖 127/8 与 ::1", () => {
    assert.deepEqual(portsFromCommand("PORT=3000 vite --port 3000"), [3000]);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("[::1]"), true);
    assert.equal(isLoopbackHost("127.0.0.9"), true);
    assert.equal(isLoopbackHost("example.com"), false);
    assert.equal(isLoopbackHost("192.168.1.5"), false);
  });
});

describe("后台服务观测 · 命中判定", () => {
  it("执行前不可连、执行后能连：记为本次命令起的服务", async () => {
    const port = await freePort();
    const { observed, hooks } = collector();
    let close: (() => Promise<void>) | undefined;
    const base: BashOperations = {
      exec: async () => {
        // 服务晚于命令返回才 listen —— 正是「一次探测不够、需要重试窗口」的场景
        await delay(50);
        close = await listen(port);
        return { exitCode: 0 };
      },
    };

    await withServiceWatch(base, hooks).exec(`pnpm dev --port ${port} &`, "/tmp", {
      onData: () => {},
    });
    await waitForObservation(observed);

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.port, port);
    assert.equal(observed[0]?.cwd, "/tmp");
    await close?.();
  });

  it("命令文本里没有端口时，按输出里打印的地址记账", async () => {
    const port = await freePort();
    const { observed, hooks } = collector();
    let close: (() => Promise<void>) | undefined;
    const base: BashOperations = {
      exec: async (command, cwd, options) => {
        // 服务晚于命令返回才 listen：`npm run dev` 那类命令的真实形态（靠重试窗口才认得出）
        await delay(50);
        close = await listen(port);
        // 服务把地址打在自己输出里（端口写在 package.json，命令文本里没有）
        options.onData(Buffer.from(`  Local:   http://localhost:${port}/\n`));
        return { exitCode: 0 };
      },
    };

    await withServiceWatch(base, hooks).exec("pnpm dev", "/tmp", { onData: () => {} });
    await waitForObservation(observed);

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.port, port);
    await close?.();
  });

  it("执行前就能连上的端口不算本次命令起的", async () => {
    const port = await freePort();
    const close = await listen(port);
    const { observed, hooks } = collector();

    await withServiceWatch(noop, hooks).exec(`curl http://localhost:${port}`, "/tmp", {
      onData: () => {},
    });
    await delay(400);

    assert.equal(observed.length, 0);
    await close();
  });

  it("执行前后都连不上就不记", async () => {
    const port = await freePort();
    const { observed, hooks } = collector();

    await withServiceWatch(noop, hooks).exec(`pnpm dev --port ${port}`, "/tmp", {
      onData: () => {},
    });
    await delay(1_600);

    assert.equal(observed.length, 0);
  });

  it("命令抛错（超时 / 中断）时仍结算：服务已 detach 存活", async () => {
    const port = await freePort();
    const { observed, hooks } = collector();
    let close: (() => Promise<void>) | undefined;
    const base: BashOperations = {
      exec: async () => {
        close = await listen(port);
        throw new Error("timeout:600");
      },
    };

    await assert.rejects(
      withServiceWatch(base, hooks).exec(`pnpm dev --port ${port} &`, "/tmp", {
        onData: () => {},
      }),
    );
    await waitForObservation(observed);

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.port, port);
    await close?.();
  });
});
