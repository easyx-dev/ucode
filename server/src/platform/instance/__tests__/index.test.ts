/** platform/instance：实例身份核对（`--restart` 据此决定要不要结束一个进程） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesInstance } from "..";

const payload = (data: Record<string, unknown>): unknown => ({
  success: true,
  code: "ok",
  message: "",
  data,
});

describe("matchesInstance", () => {
  it("注册文件有 instanceId 时必须精确匹配", () => {
    assert.equal(matchesInstance("a", payload({ up: true, instanceId: "a" })), true);
    assert.equal(matchesInstance("a", payload({ up: true, instanceId: "b" })), false);
    assert.equal(matchesInstance("a", payload({ up: true })), false, "服务没回报身份就不认");
  });

  it("注册文件没有 instanceId（升级前写的）时只认存活探针答了 up", () => {
    assert.equal(matchesInstance(null, payload({ up: true })), true);
    assert.equal(matchesInstance(null, payload({ up: false })), false);
    assert.equal(matchesInstance(null, payload({})), false);
  });

  it("载荷不是我们的封套时一律不认", () => {
    assert.equal(matchesInstance("a", null), false);
    assert.equal(matchesInstance("a", "<html>"), false);
    assert.equal(matchesInstance(null, { data: null }), false);
  });
});
