/** 隧道客户端：地址 → 隧道端点、重连退避、入站帧的分发决策 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ControlFrame } from "@ucode/hub-protocol";

import { HUB_RECONNECT_MAX_MS } from "../../../constants/hub";
import { classifyInbound, reconnectDelayMs, toTunnelUrl } from "../tunnel";

describe("toTunnelUrl", () => {
  it("http → ws、https → wss，末尾斜杠不留下双斜杠", () => {
    assert.equal(toTunnelUrl("http://hub.example.com"), "ws://hub.example.com/api/v1/tunnel");
    assert.equal(toTunnelUrl("https://hub.example.com/"), "wss://hub.example.com/api/v1/tunnel");
  });

  it("保留非默认端口", () => {
    assert.equal(
      toTunnelUrl("https://hub.example.com:8443"),
      "wss://hub.example.com:8443/api/v1/tunnel",
    );
  });

  it("保留地址里的路径前缀（中继挂在反代子路径下时用得上）", () => {
    assert.equal(
      toTunnelUrl("https://example.com/relay/"),
      "wss://example.com/relay/api/v1/tunnel",
    );
  });

  it("非 http(s) 与非法地址返回 null", () => {
    assert.equal(toTunnelUrl("hub.example.com"), null);
    assert.equal(toTunnelUrl("ftp://hub.example.com"), null);
    assert.equal(toTunnelUrl(""), null);
  });
});

describe("reconnectDelayMs", () => {
  const mid = (): number => 0.5;

  it("逐次翻倍，封顶后不再增长", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 9].map((attempt) => reconnectDelayMs(attempt, mid));

    assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("抖动落在 ±20% 内，且不会为负或为 0", () => {
    for (const random of [() => 0, () => 0.999, () => 0.25]) {
      for (const attempt of [0, 3, 7]) {
        const delay = reconnectDelayMs(attempt, random);
        const capped = Math.min(1_000 * 2 ** attempt, HUB_RECONNECT_MAX_MS);
        assert.ok(delay >= capped * 0.8 - 1, `${attempt} 次的下限`);
        assert.ok(delay <= capped * 1.2 + 1, `${attempt} 次的上限`);
        assert.ok(delay > 0);
      }
    }
  });
});

describe("classifyInbound", () => {
  const welcome: ControlFrame = {
    t: "welcome",
    protocol: 1,
    deviceId: "device-1",
    serverTime: "2026-02-01T00:00:00.000Z",
  };

  it("握手完成前只认 welcome / reject", () => {
    assert.equal(classifyInbound(welcome, "handshake"), "welcome");
    assert.equal(
      classifyInbound(
        { t: "reject", code: "device_unauthorized", message: "令牌无效" },
        "handshake",
      ),
      "reject",
    );
    assert.equal(
      classifyInbound(
        { t: "request", id: 1, method: "GET", path: "/api/v1/health", headers: {}, hasBody: false },
        "handshake",
      ),
      "ignore",
    );
    assert.equal(classifyInbound({ t: "ping" }, "handshake"), "ignore");
    assert.equal(classifyInbound(null, "handshake"), "ignore");
  });

  it("上线后按类型分流请求帧，握手三件套与只应由本侧发出的帧一律忽略", () => {
    assert.equal(classifyInbound({ t: "ping" }, "ready"), "ping");
    assert.equal(classifyInbound({ t: "pong" }, "ready"), "pong");
    assert.equal(classifyInbound({ t: "requestEnd", id: 3 }, "ready"), "requestEnd");
    assert.equal(classifyInbound({ t: "close", id: 3, code: 4426 }, "ready"), "close");
    assert.equal(classifyInbound({ t: "abort", id: 3, reason: "公网侧断开" }, "ready"), "abort");
    assert.equal(classifyInbound(welcome, "ready"), "ignore");
    assert.equal(
      classifyInbound({ t: "error", id: 3, code: "x", message: "y" }, "ready"),
      "ignore",
    );
    assert.equal(
      classifyInbound({ t: "response", id: 3, status: 200, headers: {} }, "ready"),
      "ignore",
    );
    assert.equal(classifyInbound(null, "ready"), "ignore");
  });
});
