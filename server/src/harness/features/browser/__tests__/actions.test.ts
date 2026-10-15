/**
 * 动作集的纯逻辑单测：ref 归一、必填校验、文本上限、滚动换算、遮挡判定。
 * 真正的执行在 session.ts（需要真浏览器，走 browser-smoke 脚本）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCROLL_STEP,
  MAX_TEXT_CHARS,
  normalizeRef,
  probeToError,
  resolveAct,
  scrollDelta,
} from "../actions";

describe("normalizeRef", () => {
  it("去掉 @ 前缀并小写", () => {
    assert.equal(normalizeRef("@E1A2"), "e1a2");
    assert.equal(normalizeRef(" e1a2 "), "e1a2");
    assert.equal(normalizeRef(undefined), "");
  });
});

describe("resolveAct", () => {
  it("click 缺 ref 立即失败，并写明下一步", () => {
    assert.throws(
      () => resolveAct({ action: "click" }),
      (error: Error & { code?: string; hint?: string }) => {
        assert.equal(error.code, "ref_not_found");
        assert.match(error.message, /browser_snapshot/);
        return true;
      },
    );
  });

  it("fill 缺 text 失败；超长文本也失败", () => {
    assert.throws(() => resolveAct({ action: "fill", ref: "@e1" }), /fill 需要 text/);
    assert.throws(
      () => resolveAct({ action: "fill", ref: "@e1", text: "x".repeat(MAX_TEXT_CHARS + 1) }),
      /字符上限/,
    );
  });

  it("press 读 key，scroll 可无 ref", () => {
    assert.equal(resolveAct({ action: "press", key: "Enter" }).key, "Enter");
    const scroll = resolveAct({ action: "scroll", direction: "up" });
    assert.equal(scroll.ref, "");
    assert.equal(scroll.direction, "up");
  });

  it("ref 归一后交给执行层", () => {
    assert.equal(resolveAct({ action: "click", ref: "@E1A2" }).ref, "e1a2");
  });

  it("缺 key 的 press 失败", () => {
    assert.throws(() => resolveAct({ action: "press" }), /press 需要 key/);
  });
});

describe("scrollDelta", () => {
  it("按方向给出位移，未知方向回落向下", () => {
    assert.deepEqual(scrollDelta("up"), { dx: 0, dy: -DEFAULT_SCROLL_STEP });
    assert.deepEqual(scrollDelta("right", 100), { dx: 100, dy: 0 });
    assert.deepEqual(scrollDelta(), { dx: 0, dy: DEFAULT_SCROLL_STEP });
  });

  it("非法与过大的距离都被夹住", () => {
    assert.deepEqual(scrollDelta("down", -5), { dx: 0, dy: DEFAULT_SCROLL_STEP });
    assert.deepEqual(scrollDelta("down", 10 ** 9), { dx: 0, dy: 10 * DEFAULT_SCROLL_STEP });
  });
});

describe("probeToError", () => {
  it("命中即无错误", () => {
    assert.equal(probeToError({ matched: true, missing: false }, "e1"), null);
  });

  it("元素消失 → stale_ref，并带 staleRefs 信号位", () => {
    const error = probeToError({ matched: false, missing: true }, "e1");
    assert.equal(error?.code, "stale_ref");
    assert.equal(error?.staleRefs, true);
    assert.match(error?.message ?? "", /browser_snapshot/);
  });

  it("被遮挡 → element_obstructed，并指出是谁挡的", () => {
    const error = probeToError(
      { matched: false, missing: false, blocker: 'div "cookie 提示"' },
      "e5",
    );
    assert.equal(error?.code, "element_obstructed");
    assert.match(error?.message ?? "", /cookie 提示/);
    assert.equal(error?.staleRefs, false);
  });

  it("无法判定时把原因写进提示", () => {
    const error = probeToError(
      {
        matched: false,
        missing: false,
        undecidable: true,
        reason: "中心点在视口之外（先 scroll 到它）",
      },
      "e7",
    );
    assert.match(error?.message ?? "", /视口之外/);
  });
});
