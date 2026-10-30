/** 转发到本机服务：请求头剥 / 补、响应头过滤、上游 URL 拼装 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  forwardToLocal,
  type LocalForwardFailure,
  type LocalTarget,
  resolveUpstreamUrl,
  toHeaderRecord,
} from "../forward";

const TARGET: LocalTarget = { origin: "http://127.0.0.1:19688", serviceToken: "service-token" };

describe("buildUpstreamHeaders", () => {
  it("补本机 serviceToken，来源头原样透传", () => {
    const headers = buildUpstreamHeaders(
      {
        accept: "text/event-stream",
        "x-hub-source": "tunnel",
        "x-hub-device": "device-1",
        "x-hub-client": "client-1",
      },
      "service-token",
    );

    assert.equal(headers.authorization, "Bearer service-token");
    assert.equal(headers["x-hub-source"], "tunnel");
    assert.equal(headers["x-hub-device"], "device-1");
    assert.equal(headers["x-hub-client"], "client-1");
    assert.equal(headers.accept, "text/event-stream");
  });

  it("剥掉逐跳头与「这一跳自己决定」的头（大小写不敏感）", () => {
    const headers = buildUpstreamHeaders(
      {
        Connection: "keep-alive",
        "transfer-encoding": "chunked",
        Upgrade: "websocket",
        Host: "abcd.hub.example.com",
        "Content-Length": "128",
        cookie: "hub_session=xxx",
        authorization: "Bearer hub-user-token",
        "content-type": "application/json",
      },
      "service-token",
    );

    assert.deepEqual(headers, {
      "content-type": "application/json",
      authorization: "Bearer service-token",
    });
  });
});

describe("buildDownstreamHeaders", () => {
  it("只剥逐跳头，content-type / cache-control / content-length 原样保留", () => {
    const headers = buildDownstreamHeaders({
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "content-length": "42",
      "x-accel-buffering": "no",
      "Transfer-Encoding": "chunked",
      connection: "keep-alive",
    });

    assert.deepEqual(headers, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "content-length": "42",
      "x-accel-buffering": "no",
    });
  });
});

describe("toHeaderRecord", () => {
  it("单值原样、多值按 HTTP 规则逗号连接、undefined 丢掉", () => {
    const record = toHeaderRecord({
      "content-type": "application/json",
      "set-cookie": ["a=1", "b=2"],
      etag: undefined,
    });

    assert.deepEqual(record, {
      "content-type": "application/json",
      "set-cookie": "a=1, b=2",
    });
  });
});

describe("resolveUpstreamUrl", () => {
  it("保留查询串", () => {
    const url = resolveUpstreamUrl(TARGET, "/api/v1/events?a=1&b=2");

    assert.equal(url?.href, "http://127.0.0.1:19688/api/v1/events?a=1&b=2");
  });

  it("拒掉非绝对路径与协议相对路径", () => {
    assert.equal(resolveUpstreamUrl(TARGET, "api/v1/events"), null);
    assert.equal(resolveUpstreamUrl(TARGET, "//evil.example.com/x"), null);
    assert.equal(resolveUpstreamUrl(TARGET, ""), null);
  });
});

describe("forwardToLocal", () => {
  const frame = (over: { method?: string; path?: string; headers?: Record<string, string> }) =>
    ({
      t: "request",
      id: 1,
      method: over.method ?? "GET",
      path: over.path ?? "/api/v1/status",
      headers: over.headers ?? {},
      hasBody: false,
    }) as const;

  const failures = (): LocalForwardFailure[] => [];

  it("method / 头名不是合法 HTTP token 时回错误帧，而不是把异常抛给调用方", () => {
    // 抛出去的话调用方只能记日志，中继侧收不到 error 帧，公网请求会一直等到超时
    for (const input of [frame({ method: "GE T" }), frame({ headers: { "a b": "x" } })]) {
      const seen = failures();
      forwardToLocal(
        { frame: input, target: TARGET },
        {
          onResponse: () => assert.fail("不该有响应"),
          onData: () => assert.fail("不该有数据"),
          onEnd: () => assert.fail("不该结束"),
          onError: (failure) => seen.push(failure),
        },
      );
      assert.equal(seen.length, 1, JSON.stringify(input));
      assert.equal(seen[0]?.code, "invalid_request");
    }
  });
});
