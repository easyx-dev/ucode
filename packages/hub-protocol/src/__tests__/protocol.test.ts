/**
 * 协议包的自测：帧编解码的边界、控制帧校验、切块。
 * 这些是两端行为对称的保证，任一侧改协议都必须让这里先红。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROL_STREAM_ID,
  chunkPayload,
  decodeControlFrame,
  decodeDataFrame,
  encodeControlFrame,
  encodeDataFrame,
  FRAME_HEADER_BYTES,
  MAX_FRAME_PAYLOAD,
  PROTOCOL_VERSION,
} from "../index";

describe("数据帧编解码", () => {
  it("往返一致（含空载荷）", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = decodeDataFrame(encodeDataFrame({ kind: 0, streamId: 7, payload }));
    assert.equal(frame?.kind, 0);
    assert.equal(frame?.streamId, 7);
    assert.deepEqual(Array.from(frame?.payload ?? []), [1, 2, 3, 4]);

    const empty = decodeDataFrame(
      encodeDataFrame({ kind: 1, streamId: 1, payload: new Uint8Array() }),
    );
    assert.equal(empty?.payload.byteLength, 0);
  });

  it("头部固定 9 字节", () => {
    const encoded = encodeDataFrame({ kind: 0, streamId: 1, payload: new Uint8Array([9]) });
    assert.equal(encoded.byteLength, FRAME_HEADER_BYTES + 1);
    assert.equal(CONTROL_STREAM_ID, 0);
  });

  it("拒收头部不足、流号 0、类型未知与截断的帧", () => {
    assert.equal(decodeDataFrame(new Uint8Array([0, 0])), null);

    const zeroStream = encodeDataFrame({ kind: 0, streamId: 1, payload: new Uint8Array([1]) });
    new DataView(zeroStream.buffer).setUint32(1, 0);
    assert.equal(decodeDataFrame(zeroStream), null);

    const unknownKind = encodeDataFrame({ kind: 0, streamId: 1, payload: new Uint8Array([1]) });
    unknownKind[0] = 9;
    assert.equal(decodeDataFrame(unknownKind), null);

    const truncated = encodeDataFrame({ kind: 0, streamId: 1, payload: new Uint8Array([1, 2, 3]) });
    assert.equal(decodeDataFrame(truncated.subarray(0, FRAME_HEADER_BYTES + 1)), null);
  });

  it("超过上限的载荷在编码时就被拦下", () => {
    assert.throws(
      () =>
        encodeDataFrame({ kind: 0, streamId: 1, payload: new Uint8Array(MAX_FRAME_PAYLOAD + 1) }),
      /切块/,
    );
  });

  it("切块：空载荷不产生块，边界正好整除时不多发空块", () => {
    assert.equal(chunkPayload(new Uint8Array()).length, 0);
    assert.deepEqual(
      chunkPayload(new Uint8Array(10), 4).map((chunk) => chunk.byteLength),
      [4, 4, 2],
    );
    assert.deepEqual(
      chunkPayload(new Uint8Array(8), 4).map((chunk) => chunk.byteLength),
      [4, 4],
    );
  });
});

describe("控制帧", () => {
  it("握手与请求帧往返一致", () => {
    const hello = decodeControlFrame(
      encodeControlFrame({ t: "hello", protocol: PROTOCOL_VERSION, clientVersion: "0.3.0" }),
    );
    assert.deepEqual(hello, { t: "hello", protocol: PROTOCOL_VERSION, clientVersion: "0.3.0" });

    const request = decodeControlFrame(
      encodeControlFrame({
        t: "request",
        id: 3,
        method: "POST",
        path: "/api/v1/messages/prompt?x=1",
        headers: { "content-type": "application/json" },
        hasBody: true,
      }),
    );
    if (request?.t !== "request") assert.fail("应解析成请求帧");
    assert.equal(request.id, 3);
    assert.equal(request.path, "/api/v1/messages/prompt?x=1");
    assert.equal(request.upgrade, undefined);
  });

  it("升级请求带 upgrade，普通请求不带", () => {
    const upgraded = decodeControlFrame(
      encodeControlFrame({
        t: "request",
        id: 4,
        method: "GET",
        path: "/api/v1/terminal/stream?ticket=x",
        headers: {},
        hasBody: false,
        upgrade: true,
      }),
    );
    if (upgraded?.t !== "request") assert.fail("应解析成请求帧");
    assert.equal(upgraded.upgrade, true);
  });

  it("close 帧带 WebSocket 关闭码，越界与缺失一律拒收", () => {
    const closed = decodeControlFrame(
      encodeControlFrame({ t: "close", id: 5, code: 4426, reason: "exit:0" }),
    );
    assert.deepEqual(closed, { t: "close", id: 5, code: 4426, reason: "exit:0" });

    assert.equal(decodeControlFrame(JSON.stringify({ t: "close", id: 5, code: 999 })), null);
    assert.equal(decodeControlFrame(JSON.stringify({ t: "close", id: 5, code: 5000 })), null);
    assert.equal(decodeControlFrame(JSON.stringify({ t: "close", id: 5 })), null);
  });

  it("认不出的一律返回 null", () => {
    assert.equal(decodeControlFrame("not json"), null);
    assert.equal(decodeControlFrame(JSON.stringify({ t: "unknown" })), null);
    assert.equal(decodeControlFrame(JSON.stringify({ t: "request", id: 0 })), null);
    assert.equal(decodeControlFrame(JSON.stringify({ t: "error", id: 2, code: "x" })), null);
  });
});
