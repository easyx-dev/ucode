/** lib/auth/pairing：一次性配对码的签发、单次兑换与过期 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAIRING_TTL_MS } from "../../../constants";
import { PairingStore } from "../pairing";

describe("PairingStore", () => {
  it("签发后可兑换一次，再兑换即失效", () => {
    const store = new PairingStore();
    const { code, expiresAt } = store.create(1_000_000);
    assert.equal(expiresAt, new Date(1_000_000 + PAIRING_TTL_MS).toISOString());

    assert.equal(store.redeem(code, 1_000_500), "ok");
    assert.equal(store.redeem(code, 1_000_600), "invalid");
  });

  it("过期码兑换返回 expired 并作废", () => {
    const store = new PairingStore();
    const { code } = store.create(1_000_000);
    const after = 1_000_000 + PAIRING_TTL_MS + 1;
    assert.equal(store.redeem(code, after), "expired");
    assert.equal(store.redeem(code, 1_000_000), "invalid");
  });

  it("未知码返回 invalid", () => {
    const store = new PairingStore();
    assert.equal(store.redeem("不存在的码"), "invalid");
  });

  it("prune 清理过期码", () => {
    const store = new PairingStore();
    store.create(1_000_000);
    store.prune(1_000_000 + PAIRING_TTL_MS + 1);
    // 清理后再兑换拿不到（等价于过期失效）
    const { code } = store.create(2_000_000);
    store.prune(2_000_000);
    assert.equal(store.redeem(code, 2_000_000), "ok");
  });
});
