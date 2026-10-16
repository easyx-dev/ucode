/**
 * 耗时标签：紧凑可读、按需切换精度。
 *
 * `precision` 那一档是为实时读数准备的——按秒刷新的读数留着一位小数只会永远停在同一个数字上。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { durationLabel } from "../time";

describe("durationLabel", () => {
  it("默认给到一位小数：秒以下的精度对落定的耗时有意义", () => {
    assert.equal(durationLabel(0), "0ms");
    assert.equal(durationLabel(840), "840ms");
    assert.equal(durationLabel(3240), "3.2s");
    // 秒以下先取整再判进位，59.96s 不该显示成 60.0s
    assert.equal(durationLabel(59_960), "1m00s");
    assert.equal(durationLabel(65_000), "1m05s");
    assert.equal(durationLabel(3_725_000), "1h02m");
  });

  it("`second` 只报整数秒：实时读数按秒刷新，小数位只会卡住不动", () => {
    assert.equal(durationLabel(3240, "second"), "3s");
    assert.equal(durationLabel(58_600, "second"), "59s");
    // 分档与精度无关
    assert.equal(durationLabel(65_000, "second"), "1m05s");
    assert.equal(durationLabel(3_725_000, "second"), "1h02m");
  });

  it("非法值返回空串：调用方据此跳过这一处读数", () => {
    assert.equal(durationLabel(Number.NaN), "");
    assert.equal(durationLabel(-1), "");
  });
});
