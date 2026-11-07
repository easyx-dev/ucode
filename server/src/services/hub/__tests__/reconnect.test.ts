/** 中继拒绝之后的处置口径：只有凭据失效与协议不兼容才停手，其余照常重连 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeReject, isPermanentReject } from "../reconnect";

describe("isPermanentReject", () => {
  it("凭据失效与协议不兼容是永久的", () => {
    assert.equal(isPermanentReject("device_unauthorized"), true);
    assert.equal(isPermanentReject("protocol_mismatch"), true);
  });

  it("被新连接接管不是永久的：新的那条可能马上断开，本侧应当抢回来", () => {
    assert.equal(isPermanentReject("device_taken_over"), false);
    assert.equal(isPermanentReject("tunnel_busy"), false);
    assert.equal(isPermanentReject("anything_else"), false);
  });
});

describe("describeReject", () => {
  it("凭据失效要说清下一步（去设置页重新登录）", () => {
    assert.match(describeReject("device_unauthorized", "device credential rejected"), /重新登录/);
  });

  it("其余拒绝带原始原因", () => {
    assert.match(
      describeReject("device_taken_over", "该设备已在新的隧道连接上上线"),
      /新的隧道连接/,
    );
  });
});
