/** 中继 store：状态刷新的错误归并，登录 / 登出时快照与 busy 的起落，写入 provider 的在途与错误 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HubProviderResponse, HubStatusResponse } from "@ucode/contracts";

import type { Apis } from "../../apis";
import { ApiError } from "../../error";
import { createHubStore } from "../hub";

const statusOf = (patch: Partial<HubStatusResponse> = {}): HubStatusResponse => ({
  configured: false,
  url: null,
  username: null,
  deviceId: null,
  deviceName: null,
  running: false,
  runtime: { connected: false, connectedAt: null, lastError: null, reconnectAttempt: 0 },
  ...patch,
});

const CONNECTED = statusOf({
  configured: true,
  url: "https://hub.example.com",
  username: "alice",
  deviceId: "dev_1",
  deviceName: "mac",
  running: true,
  runtime: {
    connected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastError: null,
    reconnectAttempt: 0,
  },
});

const UNREACHABLE = new ApiError("hub_unreachable", "连不上中继");

const WRITTEN: HubProviderResponse = {
  providerId: "relay",
  baseUrl: "https://hub.example.com/v1",
  models: ["glm-4.6"],
  outcome: "created",
};

/** 只替 hub 一组的假接口层：store 不碰其余域 */
const apisOf = (hub: Partial<Apis["hub"]>): Apis =>
  ({
    hub: {
      addProvider: async () => WRITTEN,
      ...hub,
    },
  }) as unknown as Apis;

/** 未决的 promise：用来观察在途时的状态 */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("hub store", () => {
  it("刷新成功：状态落地并清掉上一次的错误", async () => {
    const store = createHubStore({
      apis: apisOf({
        status: async () => CONNECTED,
        login: async () => CONNECTED,
        logout: async () => CONNECTED,
      }),
    });

    await store.status();

    assert.deepEqual(store.getState().data, CONNECTED);
    assert.equal(store.getState().error, null);
  });

  it("刷新失败：记下错误并保留上一份状态，界面不闪回空态", async () => {
    let fail = false;
    const store = createHubStore({
      apis: apisOf({
        status: async () => {
          if (fail) throw UNREACHABLE;
          return CONNECTED;
        },
        login: async () => CONNECTED,
        logout: async () => CONNECTED,
      }),
    });

    await store.status();
    fail = true;
    await store.status();

    assert.deepEqual(store.getState().data, CONNECTED);
    assert.equal(store.getState().error?.code, "hub_unreachable");
    // 刷新不动 busy：轮询不该把提交按钮按住
    assert.equal(store.getState().busy, false);
  });

  it("登录：在途置 busy，成功后换快照并清掉错误", async () => {
    const pending = deferred<HubStatusResponse>();
    const store = createHubStore({
      apis: apisOf({
        status: async () => CONNECTED,
        login: () => pending.promise,
        logout: async () => CONNECTED,
      }),
    });

    const logging = store.login({ username: "alice", password: "secret" });
    assert.equal(store.getState().busy, true);

    pending.resolve(CONNECTED);
    assert.equal(await logging, true);
    assert.equal(store.getState().busy, false);
    assert.deepEqual(store.getState().data, CONNECTED);
    assert.equal(store.getState().error, null);
  });

  it("登录失败：返回 false，busy 归位并把原因留给界面", async () => {
    const store = createHubStore({
      apis: apisOf({
        status: async () => statusOf(),
        login: async () => {
          throw UNREACHABLE;
        },
        logout: async () => statusOf(),
      }),
    });

    assert.equal(await store.login({ username: "alice", password: "secret" }), false);
    assert.equal(store.getState().busy, false);
    assert.equal(store.getState().error?.code, "hub_unreachable");
  });

  it("登出成功：状态换成未接入（地址保留），订阅方收到通知", async () => {
    const loggedOut = statusOf({ url: "https://hub.example.com" });
    const store = createHubStore({
      apis: apisOf({
        status: async () => CONNECTED,
        login: async () => CONNECTED,
        logout: async () => loggedOut,
      }),
    });

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    await store.status();
    assert.equal(await store.logout(), true);
    unsubscribe();

    assert.deepEqual(store.getState().data, loggedOut);
    assert.equal(store.getState().busy, false);
    assert.equal(notified, 3);
  });

  it("写入 provider：在途置 providerBusy，成功后留下结果", async () => {
    const pending = deferred<HubProviderResponse>();
    const store = createHubStore({
      apis: apisOf({ addProvider: () => pending.promise }),
    });

    const writing = store.addProvider();
    assert.equal(store.getState().providerBusy, true);

    pending.resolve(WRITTEN);
    assert.deepEqual(await writing, WRITTEN);
    assert.deepEqual(store.getState().providerResult, WRITTEN);
    assert.equal(store.getState().providerBusy, false);
    assert.equal(store.getState().providerError, null);
    // 写入不碰状态刷新的那格错误：两者在页面上是两处提示
    assert.equal(store.getState().error, null);
  });

  it("写入 provider 失败：错误落在 providerError，不留半截结果", async () => {
    const store = createHubStore({
      apis: apisOf({
        addProvider: async () => {
          throw UNREACHABLE;
        },
      }),
    });

    assert.equal(await store.addProvider(), null);
    assert.equal(store.getState().providerError?.code, "hub_unreachable");
    assert.equal(store.getState().providerBusy, false);
    assert.equal(store.getState().providerResult, null);
  });
});
