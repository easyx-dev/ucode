/**
 * 后台服务运行态单测：按端口合并、探不到即移除、超限时的收敛与清理。
 *
 * 探活走真实回环连接（判定就是「能不能连上」），用例自己起 `node:net` 服务当被观测对象；
 * 事件总线用假对象，只记录下发的帧。
 */
import assert from "node:assert/strict";
import { type AddressInfo, createServer } from "node:net";
import { describe, it } from "node:test";

import type { BackgroundService } from "@ucode/contracts";

import { SERVICE_MAX_TRACKED_PER_SESSION } from "../../constants/tools";
import { BackgroundServices } from "../background-services";
import type { SessionEventBus } from "../event-bus";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const freePorts = async (count: number): Promise<number[]> => {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    ports.push((server.address() as AddressInfo).port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return ports;
};

const listen = async (port: number): Promise<() => Promise<void>> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
};

/** 只记录下发的帧：清单是全量的，测试直接看最后一帧的载荷 */
const createHarness = (): {
  services: BackgroundServices;
  frames: Array<{ sessionId: string; type: string; data: unknown }>;
} => {
  const frames: Array<{ sessionId: string; type: string; data: unknown }> = [];
  const events = {
    emitFrame: (sessionId: string, type: string, data: unknown) => {
      frames.push({ sessionId, type, data });
    },
  } as unknown as SessionEventBus;
  return { services: new BackgroundServices(events), frames };
};

const lastFrame = (frames: Array<{ data: unknown }>): BackgroundService[] =>
  frames.at(-1)?.data as BackgroundService[];

describe("BackgroundServices", () => {
  it("observe 记一条并下发全量帧", async () => {
    const [port] = await freePorts(1);
    const { services, frames } = createHarness();

    services.observe("s1", { command: "pnpm dev --port 5173", cwd: "/w", port: port ?? 0 });

    const [service] = services.listOf("s1");
    assert.equal(service?.id, String(port));
    assert.equal(service?.url, `http://127.0.0.1:${port}`);
    assert.equal(service?.cwd, "/w");
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.type, "service_update");
    assert.deepEqual(lastFrame(frames), services.listOf("s1"));
  });

  it("同端口重复起即覆盖，不新增条目", async () => {
    const [port] = await freePorts(1);
    const { services } = createHarness();

    services.observe("s1", { command: "pnpm dev --port 5173", cwd: "/w", port: port ?? 0 });
    const first = services.listOf("s1")[0];
    services.observe("s1", { command: "vite --port 5173", cwd: "/w2", port: port ?? 0 });

    const list = services.listOf("s1");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.command, "vite --port 5173");
    assert.equal(list[0]?.cwd, "/w2");
    assert.equal(first?.port, list[0]?.port);
  });

  it("仍在跑的端口留在清单里，且不重复下发", async (t) => {
    const [port] = await freePorts(1);
    const close = await listen(port ?? 0);
    // 收尾放 `t.after`：断言一抛就跳过后面的收尾，监听口会把测试进程挂住（同 services.test.ts）
    t.after(() => close());
    const { services, frames } = createHarness();

    services.observe("s1", { command: "pnpm dev", cwd: "/w", port: port ?? 0 });
    const before = frames.length;

    await services.refresh("s1");

    assert.equal(services.listOf("s1").length, 1, "探得到就留着");
    assert.equal(frames.length, before, "清单没变不应重复下发");
  });

  it("探不到的端口从清单移除，并下发一帧", async () => {
    const [port] = await freePorts(1);
    const close = await listen(port ?? 0);
    const { services, frames } = createHarness();

    services.observe("s1", { command: "pnpm dev", cwd: "/w", port: port ?? 0 });
    const before = frames.length;

    await close();
    await services.refresh("s1");

    assert.deepEqual(services.listOf("s1"), []);
    assert.equal(frames.length, before + 1);
    assert.deepEqual(lastFrame(frames), []);
  });

  it("没有该会话的清单时 refresh 是空操作", async () => {
    const { services, frames } = createHarness();
    await services.refresh("s1");
    assert.equal(frames.length, 0);
  });

  it("超出条数上限时丢最久未确认的一项", async () => {
    const ports = await freePorts(SERVICE_MAX_TRACKED_PER_SESSION + 1);
    const { services } = createHarness();

    for (const port of ports) {
      services.observe("s1", { command: `serve --port ${port}`, cwd: "/w", port });
      // 让 updatedAt 有先后，收敛时丢的才是最早那条
      await delay(2);
    }

    const list = services.listOf("s1");
    assert.equal(list.length, SERVICE_MAX_TRACKED_PER_SESSION);
    assert.equal(
      list.some((service) => service.port === ports[0]),
      false,
      "被丢的应是最早记录的那一条",
    );
    assert.equal(
      list.some((service) => service.port === ports.at(-1)),
      true,
    );
  });

  it("forget 清掉会话的整份清单", async () => {
    const [port] = await freePorts(1);
    const { services } = createHarness();

    services.observe("s1", { command: "pnpm dev", cwd: "/w", port: port ?? 0 });
    services.forget("s1");
    assert.deepEqual(services.listOf("s1"), []);
  });
});
