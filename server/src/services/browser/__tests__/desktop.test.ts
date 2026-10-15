/** 桌面端浏览器通道的状态与握手票：接上才有状态、断开即清空、票一次性 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DesktopBrowserTab } from "@ucode/contracts";

import { DESKTOP_CHANNEL_CLOSE_REPLACED } from "@ucode/contracts";

import { createDesktopBrowsers, type DesktopChannel } from "../desktop";

/** 造一条通道：记下它被关掉的码，用来验「被顶掉的那个知道退场」 */
const channel = (): DesktopChannel & { closedWith: number[]; frames: unknown[] } => {
  const closedWith: number[] = [];
  const frames: unknown[] = [];
  return {
    closedWith,
    frames,
    close: (code) => closedWith.push(code),
    send: (frame) => frames.push(frame),
  };
};

const tab = (id: string, active = false): DesktopBrowserTab => ({
  id,
  title: `页面 ${id}`,
  url: `https://example.com/${id}`,
  webContentsId: 42,
  active,
});

describe("桌面端浏览器通道", () => {
  it("没接上时没有状态、也没有可驱动的标签", () => {
    const desktop = createDesktopBrowsers();
    assert.deepEqual(desktop.state(), { connected: false, tabs: [] });
    assert.equal(desktop.activeTab(), null);
  });

  it("接上并报标签后，激活的那个就是 agent 要驱动的", () => {
    const desktop = createDesktopBrowsers();
    const first = channel();
    desktop.attach(first);
    assert.equal(desktop.state().connected, true);

    desktop.setTabs(first, [tab("t1"), tab("t2", true)]);
    assert.equal(desktop.state().tabs.length, 2);
    assert.equal(desktop.activeTab()?.id, "t2");
  });

  it("断开即清空：没有连接就没有可驱动的桌面浏览器", () => {
    const desktop = createDesktopBrowsers();
    const first = channel();
    desktop.attach(first);
    desktop.setTabs(first, [tab("t1", true)]);
    desktop.detach(first);

    assert.deepEqual(desktop.state(), { connected: false, tabs: [] });
    assert.equal(desktop.activeTab(), null);
  });

  it("新通道接上会顶掉旧的：旧的被关掉，且它发来的标签不再生效", () => {
    const desktop = createDesktopBrowsers();
    const first = channel();
    const second = channel();
    desktop.attach(first);
    desktop.setTabs(first, [tab("old", true)]);

    desktop.attach(second);
    assert.deepEqual(
      first.closedWith,
      [DESKTOP_CHANNEL_CLOSE_REPLACED],
      "旧连接要被关掉，否则它会一直发",
    );
    assert.deepEqual(desktop.state().tabs, []);

    desktop.setTabs(first, [tab("stale", true)]);
    assert.deepEqual(desktop.state().tabs, [], "旧通道的报送要忽略");

    desktop.detach(first);
    assert.equal(desktop.state().connected, true, "旧通道的 close 不该把新通道的状态清掉");

    desktop.setTabs(second, [tab("new", true)]);
    assert.equal(desktop.activeTab()?.id, "new");
  });

  it("一个标签都没开时没有可驱动的目标", () => {
    const desktop = createDesktopBrowsers();
    const first = channel();
    desktop.attach(first);
    desktop.setTabs(first, [tab("t1"), tab("t2")]);
    assert.equal(desktop.activeTab(), null);
  });

  it("握手票一次性，且首次连接（还没接上）也签得出来", () => {
    const desktop = createDesktopBrowsers();
    const issued = desktop.issueTicket();
    assert.ok(issued.ticket.length > 0);

    assert.equal(desktop.peekTicket(issued.ticket), true);
    assert.equal(desktop.peekTicket("no-such-ticket"), false);
    assert.equal(desktop.peekTicket(issued.ticket), true, "预检不消耗票");

    assert.equal(desktop.redeemTicket(issued.ticket), true);
    assert.equal(desktop.redeemTicket(issued.ticket), false, "同一张票只能用一次");
  });
});
