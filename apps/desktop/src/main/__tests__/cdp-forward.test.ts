/** CDP 转发：只认登记的标签、按需挂 debugger、结果与事件都回给服务端 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCdpForwarder, type GuestHandle } from "../cdp-forward";

type Sent = {
  type: string;
  id?: number;
  result?: unknown;
  error?: { message: string };
  webContentsId?: number;
};

/** 取回话里的错误文案（成功帧没有 error） */
const errorText = (frame: Sent | undefined): string => frame?.error?.message ?? "";

type MessageListener = (event: unknown, method: string, params: object, sessionId?: string) => void;

const makeGuest = (id: number, options: { attached?: boolean; fail?: string } = {}) => {
  const commands: { method: string; params?: object }[] = [];
  const listeners: MessageListener[] = [];
  let attachCount = options.attached === true ? 1 : 0;

  const guest = {
    id,
    destroyed: false,
    isDestroyed: () => guest.destroyed,
    debugger: {
      isAttached: () => options.attached === true,
      attach: (version: string) => {
        assert.equal(version, "1.3");
        attachCount += 1;
        options.attached = true;
      },
      on: (_event: "message", listener: MessageListener) => {
        listeners.push(listener);
      },
      sendCommand: async (method: string, params?: object) => {
        commands.push({ method, params });
        if (options.fail) throw new Error(options.fail);
        return { ok: method };
      },
    },
    /** 测试用：模拟目标页面发事件 */
    emit: (method: string, params: object, sessionId?: string) => {
      for (const listener of listeners) listener({}, method, params, sessionId);
    },
    /** 测试用：模拟 debugger 掉了（别人抢了 / Chromium 自己断的）——监听仍在，只是需要重新 attach */
    dropDebugger: () => {
      options.attached = false;
    },
    attachCount: () => attachCount,
  };
  return guest as unknown as GuestHandle & {
    emit: typeof guest.emit;
    dropDebugger: typeof guest.dropDebugger;
    attachCount: typeof guest.attachCount;
    destroyed: boolean;
  };
};

const harness = () => {
  const guests = new Map<number, ReturnType<typeof makeGuest>>();
  const sent: Sent[] = [];
  const forwarder = createCdpForwarder({
    lookup: (id) => guests.get(id),
    send: (frame) => sent.push(frame as unknown as Sent),
  });
  return { guests, sent, forwarder };
};

describe("CDP 转发", () => {
  it("没登记的 webContents 一律拒绝（服务端驱动不了我们的界面）", async () => {
    const { guests, sent, forwarder } = harness();
    guests.set(7, makeGuest(7));

    await forwarder.handle({ id: 1, webContentsId: 7, method: "Runtime.evaluate" });

    assert.equal(sent.length, 1);
    assert.match(errorText(sent[0]), /不是本应用创建的浏览器标签/);
  });

  it("登记过的标签：按需挂 debugger，命令结果原样回传", async () => {
    const { guests, sent, forwarder } = harness();
    const guest = makeGuest(7);
    guests.set(7, guest);
    forwarder.register(7);

    await forwarder.handle({
      id: 2,
      webContentsId: 7,
      method: "Runtime.evaluate",
      params: { expression: "1+1" },
    });

    assert.deepEqual(sent, [{ type: "cdp-result", id: 2, result: { ok: "Runtime.evaluate" } }]);
  });

  it("目标已销毁：明确回错，而不是挂在那里", async () => {
    const { guests, sent, forwarder } = harness();
    const guest = makeGuest(7);
    guests.set(7, guest);
    forwarder.register(7);
    guest.destroyed = true;

    await forwarder.handle({ id: 3, webContentsId: 7, method: "Page.enable" });

    assert.match(errorText(sent[0]), /已经关掉了/);
  });

  it("命令抛错也回话（否则服务端只能等超时）", async () => {
    const { guests, sent, forwarder } = harness();
    guests.set(7, makeGuest(7, { fail: "target closed" }));
    forwarder.register(7);

    await forwarder.handle({ id: 4, webContentsId: 7, method: "Page.navigate" });

    assert.match(errorText(sent[0]), /target closed/);
  });

  it("debugger 已被别人挂着时也要把事件监听挂上（否则事件静默丢失）", async () => {
    const { guests, sent, forwarder } = harness();
    const guest = makeGuest(7, { attached: true });
    guests.set(7, guest);
    forwarder.register(7);

    await forwarder.handle({ id: 10, webContentsId: 7, method: "Page.enable" });
    guest.emit("Page.frameNavigated", { frame: { url: "https://example.com/" } });

    assert.equal(
      sent.filter((frame) => frame.type === "cdp-event").length,
      1,
      "监听没挂上时事件会全丢",
    );
    assert.equal(guest.attachCount(), 1, "已经挂着就不再 attach");
  });

  it("debugger 掉了之后下一条命令会重新 attach，且事件不会重复转发", async () => {
    const { guests, sent, forwarder } = harness();
    const guest = makeGuest(7);
    guests.set(7, guest);
    forwarder.register(7);

    await forwarder.handle({ id: 11, webContentsId: 7, method: "Page.enable" });
    guest.dropDebugger();
    await forwarder.handle({ id: 12, webContentsId: 7, method: "Page.enable" });
    sent.length = 0;
    guest.emit("Page.frameNavigated", { frame: { url: "https://example.com/next" } });

    assert.equal(guest.attachCount(), 2, "掉了之后应当重新 attach");
    // 监听只挂一次：重新 attach 后再挂一遍会让每条事件转发两遍
    assert.equal(sent.filter((frame) => frame.type === "cdp-event").length, 1);
  });

  it("事件只转一次（重复命令不会重复挂监听），并在注销后停止认这个 id", async () => {
    const { guests, sent, forwarder } = harness();
    const guest = makeGuest(7);
    guests.set(7, guest);
    forwarder.register(7);

    await forwarder.handle({ id: 5, webContentsId: 7, method: "Page.enable" });
    await forwarder.handle({ id: 6, webContentsId: 7, method: "Runtime.enable" });
    guest.emit("Page.frameNavigated", { frame: { url: "https://example.com/" } });

    const events = sent.filter((frame) => frame.type === "cdp-event");
    assert.equal(events.length, 1, "同一次导航只该转一条事件");
    assert.equal(events[0]?.webContentsId, 7);

    forwarder.unregister(7);
    sent.length = 0;
    await forwarder.handle({ id: 7, webContentsId: 7, method: "Page.enable" });
    assert.match(errorText(sent[0]), /不是本应用创建的浏览器标签/);
  });
});
