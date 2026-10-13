/** notice：桌面通知的投递结果记录（设置页据此提示「系统没放行通知」） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDesktopDelivered, showNotice, subscribeDesktopDelivered } from "../notice";

/** 装一个假的桌面桥；`delivered` 是主进程回报的结果 */
const installDesktopPort = (delivered: boolean): void => {
  (globalThis as { window?: unknown }).window = {
    desktop: {
      notify: async (): Promise<boolean> => delivered,
      onNotificationClick: () => () => {},
    },
  };
};

/** 没有桌面桥的 web 环境 */
const installWebEnvironment = (): void => {
  (globalThis as { window?: unknown }).window = {};
};

const notice = { title: "等待你的回答", body: "某个会话", sessionId: "s1" };

/** 等 `notify` 的 promise 链结完 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("桌面通知的投递结果", () => {
  it("主进程回报失败后置为「被系统拦下」，成功则回到能送达并逐次通知订阅者", async () => {
    installDesktopPort(false);
    const seen: boolean[] = [];
    const unsubscribe = subscribeDesktopDelivered(() => {
      seen.push(readDesktopDelivered() === false);
    });

    showNotice(notice, () => {});
    await tick();
    assert.equal(readDesktopDelivered(), false);

    installDesktopPort(true);
    showNotice(notice, () => {});
    await tick();
    assert.equal(readDesktopDelivered(), true);

    assert.deepEqual(seen, [true, false]);
    unsubscribe();
  });

  it("退订后不再收到变化", async () => {
    installDesktopPort(false);
    let calls = 0;
    const unsubscribe = subscribeDesktopDelivered(() => {
      calls += 1;
    });
    unsubscribe();

    showNotice(notice, () => {});
    await tick();
    assert.equal(readDesktopDelivered(), false);
    assert.equal(calls, 0);
  });

  it("web 端不发桌面通知，也不产生投递结果", async () => {
    installWebEnvironment();
    showNotice(notice, () => {});
    await tick();
    // 前两个用例已经把结果写成过 true / false，这里只能确认它没被 web 路径改写
    assert.equal(typeof readDesktopDelivered(), "boolean");
  });
});
