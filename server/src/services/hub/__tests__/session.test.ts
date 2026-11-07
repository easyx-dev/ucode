/** 入站控制帧归类与两道链的分派口径：握手前只认 welcome / reject，上线后请求帧走数据链 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ControlFrame } from "@ucode/hub-protocol";

import { classifyInbound } from "../session";

const welcome: ControlFrame = {
  t: "welcome",
  protocol: 3,
  deviceId: "device-1",
  serverTime: "2026-02-01T00:00:00.000Z",
};

describe("classifyInbound", () => {
  it("握手完成前只认 welcome / reject", () => {
    assert.deepEqual(classifyInbound(welcome, "handshake"), {
      kind: "welcome",
      deviceId: "device-1",
    });
    assert.deepEqual(
      classifyInbound(
        { t: "reject", code: "device_unauthorized", message: "令牌无效" },
        "handshake",
      ),
      { kind: "reject", code: "device_unauthorized", message: "令牌无效" },
    );
    assert.deepEqual(
      classifyInbound(
        { t: "request", id: 1, method: "GET", path: "/api/v1/health", headers: {}, hasBody: false },
        "handshake",
      ),
      { kind: "ignore" },
    );
    assert.deepEqual(classifyInbound({ t: "ping" }, "handshake"), { kind: "ignore" });
    assert.deepEqual(classifyInbound(null, "handshake"), { kind: "ignore" });
  });

  it("上线后按类型分流，握手三件套与只应由本侧发出的帧一律忽略", () => {
    assert.deepEqual(classifyInbound({ t: "ping" }, "ready"), { kind: "ping" });
    assert.deepEqual(classifyInbound({ t: "pong" }, "ready"), { kind: "pong" });
    assert.deepEqual(classifyInbound({ t: "requestEnd", id: 3 }, "ready"), {
      kind: "requestEnd",
      id: 3,
    });
    assert.deepEqual(classifyInbound({ t: "close", id: 3, code: 4426 }, "ready"), {
      kind: "close",
      id: 3,
      code: 4426,
      reason: undefined,
    });
    assert.deepEqual(classifyInbound({ t: "abort", id: 3, reason: "公网侧断开" }, "ready"), {
      kind: "abort",
      id: 3,
      reason: "公网侧断开",
    });
    assert.deepEqual(classifyInbound(welcome, "ready"), { kind: "ignore" });
    assert.deepEqual(
      classifyInbound({ t: "error", id: 3, code: "local_failed", message: "y" }, "ready"),
      { kind: "ignore" },
    );
    assert.deepEqual(classifyInbound({ t: "response", id: 3, status: 200, headers: {} }, "ready"), {
      kind: "ignore",
    });
    assert.deepEqual(classifyInbound(null, "ready"), { kind: "ignore" });
  });

  it("请求帧原样交给调用方（数据链要按帧的顺序处理请求体）", () => {
    const action = classifyInbound(
      {
        t: "request",
        id: 9,
        method: "POST",
        path: "/api/v1/messages/prompt",
        headers: { "set-cookie": ["a=1", "b=2"] },
        hasBody: true,
      },
      "ready",
    );
    assert.equal(action.kind, "request");
    assert.deepEqual(action.kind === "request" ? action.frame.headers : null, {
      "set-cookie": ["a=1", "b=2"],
    });
  });
});
