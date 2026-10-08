/**
 * 函数式弹层调度的单测：队列顺序、宿主缺席时的报错、卸载结算。
 *
 * 只测 `lib/dialog` 的纯逻辑，渲染归宿主组件——本文件不依赖 DOM 与 React。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  alert,
  confirm,
  type DialogRequest,
  dialogHead,
  openDialog,
  registerDialogHost,
  settleDialog,
  settlePendingDialogs,
  subscribeDialogs,
} from "../dialog";

/** 队首请求；用例里断言过存在，这里只做一次收窄 */
const head = (): DialogRequest => {
  const request = dialogHead();
  assert.ok(request, "队列应有队首");
  return request;
};

let unregisterHost = (): void => {};

beforeEach(() => {
  unregisterHost = registerDialogHost();
});

afterEach(() => {
  unregisterHost();
});

describe("函数式弹层调度", () => {
  it("没有宿主时同步报错，不留下悬着的 Promise", () => {
    unregisterHost();
    assert.throws(() => openDialog(() => null), /弹层宿主未挂载/);
    assert.throws(() => confirm({ title: "标题" }), /弹层宿主未挂载/);
    assert.throws(() => alert({ title: "标题" }), /弹层宿主未挂载/);
    // 注销函数只执行一次，配回宿主后让 afterEach 的注销仍有对象
    unregisterHost = registerDialogHost();
  });

  it("队列串行：按入队顺序逐条结算，结算后轮到下一条", async () => {
    const custom = openDialog<string>(() => null);
    const ask = confirm({ title: "标题" });

    assert.equal(head().kind, "custom");
    settleDialog(head(), "取值");
    assert.equal(await custom, "取值");

    assert.equal(head().kind, "confirm");
    settleDialog(head(), true);
    assert.equal(await ask, true);

    assert.equal(dialogHead(), null);
  });

  it("confirm 只把 true 当确认，其余一律算取消", async () => {
    const ask = confirm({ title: "标题" });
    settleDialog(head(), undefined);
    assert.equal(await ask, false);
  });

  it("宿主卸载结算未决请求：confirm 算取消，其余给 undefined", async () => {
    const custom = openDialog<string>(() => null);
    const ask = confirm({ title: "标题" });
    const hint = alert({ title: "标题" });

    settlePendingDialogs();

    assert.equal(await custom, undefined);
    assert.equal(await ask, false);
    assert.equal(await hint, undefined);
    assert.equal(dialogHead(), null);
  });

  it("入队与出队都通知订阅者", async () => {
    let notified = 0;
    const unsubscribe = subscribeDialogs(() => {
      notified += 1;
    });

    const ask = confirm({ title: "标题" });
    assert.equal(notified, 1);

    settleDialog(head(), false);
    assert.equal(notified, 2);
    unsubscribe();
    assert.equal(await ask, false);
  });
});
