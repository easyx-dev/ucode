/**
 * 动作集的纯逻辑单测：ref 归一、必填校验、文本上限、滚动换算、遮挡判定。
 * 真正的执行在 session.ts（需要真浏览器，走 browser-smoke 脚本）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCROLL_STEP,
  formatEvalResult,
  MAX_EVAL_RESULT_CHARS,
  MAX_TEXT_CHARS,
  normalizeRef,
  probeToError,
  resolveAct,
  scrollDelta,
  toEvalError,
} from "../actions";
import { browserError } from "../errors";

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

describe("resolveAct 的 eval", () => {
  it("不要 ref，只要表达式", () => {
    assert.equal(resolveAct({ action: "eval", text: "document.title" }).text, "document.title");
  });

  it("缺表达式时失败，并提示把表达式写在 text 里", () => {
    assert.throws(
      () => resolveAct({ action: "eval" }),
      (error: Error & { hint?: string }) => {
        assert.match(error.message, /eval 需要 text/);
        assert.match(error.hint ?? "", /text/);
        return true;
      },
    );
  });
});

describe("formatEvalResult", () => {
  it("字符串原样、其余类型转紧凑 JSON", () => {
    assert.equal(formatEvalResult("登录"), "登录");
    assert.equal(formatEvalResult({ height: "32px" }), '{"height":"32px"}');
    assert.equal(formatEvalResult(0), "0");
    assert.equal(formatEvalResult(false), "false");
  });

  it("没有返回值时说清原因，而不是回一个空串", () => {
    assert.match(formatEvalResult(undefined), /没有返回值/);
    assert.match(formatEvalResult(""), /空字符串/);
  });

  it("循环引用直接报错，并给可序列化的提示", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(
      () => formatEvalResult(circular),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "action_failed");
        assert.match(error.message, /无法序列化/);
        return true;
      },
    );
  });

  it("超长结果截断并说明原长度", () => {
    const text = formatEvalResult("x".repeat(MAX_EVAL_RESULT_CHARS + 10));
    assert.match(text, /结果已截断/);
    assert.ok(text.length < MAX_EVAL_RESULT_CHARS + 60);
  });
});

describe("toEvalError", () => {
  it("语法错点到「写成 IIFE」：表达式只包一层求值", () => {
    const error = toEvalError(new SyntaxError("Unexpected token 'const'"));
    assert.match(error.message, /表达式执行失败/);
    assert.match(error.hint, /IIFE/);
  });

  it("已有更具体提示的浏览器错误不被覆盖", () => {
    const original = browserError("stale_ref", "ref 不在页面上", { hint: "重新快照" });
    assert.equal(toEvalError(original), original);
  });

  it("其余异常给可执行的下一步", () => {
    assert.match(toEvalError(new Error("boom")).hint, /控制台/);
  });
});
