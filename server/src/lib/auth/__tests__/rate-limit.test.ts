/** lib/auth/rate-limit：滑动窗口内超限拒绝，窗口滑过后重新放行 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RateLimiter } from "../rate-limit";

describe("RateLimiter", () => {
  it("窗口内超过上限即拒绝，不同键互不影响", () => {
    const limiter = new RateLimiter(2, 1000);
    assert.equal(limiter.allow("a", 0), true);
    assert.equal(limiter.allow("a", 100), true);
    assert.equal(limiter.allow("a", 200), false);
    assert.equal(limiter.allow("b", 200), true);
  });

  it("窗口滑过后重新放行", () => {
    const limiter = new RateLimiter(1, 1000);
    assert.equal(limiter.allow("a", 0), true);
    assert.equal(limiter.allow("a", 500), false);
    assert.equal(limiter.allow("a", 1001), true);
  });

  it("prune 清空空键、保留活跃键", () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.allow("a", 0);
    limiter.allow("b", 2000);
    limiter.prune(2500);
    // a 的窗口已过被清空，可再次放行
    assert.equal(limiter.allow("a", 2500), true);
  });
});
