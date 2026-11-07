/**
 * 升级流到本机 WebSocket 的泵：建连前的上行排队、双向转发、关闭码归一与失败收敛。
 * socket 是注入的假实现，所以这里不碰网络。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HeaderMap, RequestFrame } from "@ucode/hub-protocol";

import { forwardUpgradeToLocal, type UpgradeSocketLike } from "../ws-forward";

const FRAME: RequestFrame = {
  t: "request",
  id: 7,
  method: "GET",
  path: "/api/v1/terminal/stream?terminalId=t1&ticket=abc",
  headers: { "sec-websocket-key": "由本机客户端自己生成", "x-hub-device": "device-1" },
  hasBody: false,
  upgrade: true,
};

const TARGET = { origin: "http://127.0.0.1:19688", serviceToken: "service-token" };

class FakeSocket implements UpgradeSocketLike {
  /** 发出去的块：string 表示文本帧 */
  readonly sent: (string | Uint8Array)[] = [];
  closeCall: { code: number; reason?: string } | null = null;
  terminated = false;
  /** null 表示还没停过；true = 已 pause，false = 已 resume */
  paused: boolean | null = null;

  private openListener: (() => void) | null = null;
  private messageListener: ((chunk: Uint8Array, isText: boolean) => void) | null = null;
  private closeListener: ((code: number, reason: string) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
  private unexpectedListener: ((status: number) => void) | null = null;

  onOpen(listener: () => void): void {
    this.openListener = listener;
  }

  onMessage(listener: (chunk: Uint8Array, isText: boolean) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: (code: number, reason: string) => void): void {
    this.closeListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  onUnexpectedResponse(listener: (status: number) => void): void {
    this.unexpectedListener = listener;
  }

  send(chunk: string | Uint8Array): void {
    this.sent.push(chunk);
  }

  close(code: number, reason?: string): void {
    this.closeCall = { code, reason };
  }

  terminate(): void {
    this.terminated = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  emitOpen(): void {
    this.openListener?.();
  }

  emitMessage(chunk: Uint8Array, isText = false): void {
    this.messageListener?.(chunk, isText);
  }

  emitClose(code: number, reason = ""): void {
    this.closeListener?.(code, reason);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }

  emitUnexpectedResponse(status: number): void {
    this.unexpectedListener?.(status);
  }
}

const createHarness = (
  connect?: (url: string, headers: HeaderMap) => UpgradeSocketLike,
  options: { frame?: RequestFrame; onDataPending?: Promise<void> } = {},
) => {
  const socket = new FakeSocket();
  const frame = options.frame ?? FRAME;
  const onDataPending = options.onDataPending;
  let seen: { url: string; headers: HeaderMap } | null = null;
  const events: string[] = [];
  const data: Uint8Array[] = [];
  const textFlags: boolean[] = [];
  const closes: { code: number; reason: string }[] = [];
  const errors: { code: string; message: string }[] = [];
  const errorStatus: (number | undefined)[] = [];

  const handle = forwardUpgradeToLocal(
    { frame, target: TARGET },
    {
      onUpgrade: () => events.push("upgrade"),
      onData: (chunk, isText) => {
        data.push(chunk);
        textFlags.push(isText);
        return onDataPending;
      },
      onClose: (code, reason) => closes.push({ code, reason }),
      onError: (failure) => {
        errors.push({ code: failure.code, message: failure.message });
        errorStatus.push(failure.httpStatus);
      },
    },
    connect ??
      ((url, headers) => {
        seen = { url, headers };
        return socket;
      }),
  );

  return {
    handle,
    socket,
    events,
    data,
    textFlags,
    closes,
    errors,
    errorStatus,
    connection: () => seen,
  };
};

describe("forwardUpgradeToLocal", () => {
  it("换算成 ws 地址，带上 serviceToken，剥掉握手头", () => {
    const harness = createHarness();
    assert.equal(
      harness.connection()?.url,
      "ws://127.0.0.1:19688/api/v1/terminal/stream?terminalId=t1&ticket=abc",
    );
    const headers = harness.connection()?.headers ?? {};
    assert.equal(headers.authorization, "Bearer service-token");
    assert.equal(headers["x-hub-device"], "device-1");
    assert.equal(headers["sec-websocket-key"], undefined);
  });

  it("文本帧的上行按文本帧发给本机（终端的上行约定就是文本帧）", () => {
    const harness = createHarness();
    harness.handle.writeBody(new TextEncoder().encode("ls\r"), true);
    harness.socket.emitOpen();
    assert.equal(harness.socket.sent[0], "ls\r");
  });

  it("建连前的上行先排队，连上后按顺序送出", () => {
    const harness = createHarness();
    harness.handle.writeBody(new TextEncoder().encode("a"));
    harness.handle.writeBody(new TextEncoder().encode("b"));
    assert.equal(harness.socket.sent.length, 0);

    harness.socket.emitOpen();
    assert.deepEqual(harness.events, ["upgrade"]);
    assert.equal(harness.socket.sent.length, 2);
    assert.equal(new TextDecoder().decode(harness.socket.sent[0] as Uint8Array), "a");
    assert.equal(new TextDecoder().decode(harness.socket.sent[1] as Uint8Array), "b");

    harness.handle.writeBody(new TextEncoder().encode("c"));
    assert.equal(new TextDecoder().decode(harness.socket.sent[2] as Uint8Array), "c");
  });

  it("本机下行按原样交给 handler，文本帧的标记一并带出", () => {
    const harness = createHarness();
    harness.socket.emitOpen();
    harness.socket.emitMessage(new TextEncoder().encode("out"), true);
    assert.equal(new TextDecoder().decode(harness.data[0]), "out");
    assert.equal(harness.textFlags[0], true);
  });

  it("本机关闭：可发送的码原样带回，1006 之类换成 1011", () => {
    const first = createHarness();
    first.socket.emitOpen();
    first.socket.emitClose(4426, "exit:0");
    assert.deepEqual(first.closes, [{ code: 4426, reason: "exit:0" }]);

    const second = createHarness();
    second.socket.emitOpen();
    second.socket.emitClose(1006);
    assert.deepEqual(second.closes, [{ code: 1011, reason: "" }]);
  });

  it("hub 侧 close 转给本机 socket，且不再回一条 close", () => {
    const harness = createHarness();
    harness.socket.emitOpen();
    harness.handle.close(4426, "gone");

    assert.deepEqual(harness.socket.closeCall, { code: 4426, reason: "gone" });
    harness.socket.emitClose(4426, "gone");
    assert.deepEqual(harness.closes, []);
  });

  it("close 原因超过 123 字节时按字节截断（ws 的关闭帧载荷限制，超了会抛）", () => {
    const harness = createHarness();
    harness.socket.emitOpen();
    harness.handle.close(4426, "终".repeat(50));

    const reason = harness.socket.closeCall?.reason ?? "";
    assert.ok(Buffer.byteLength(reason) <= 123, `实际 ${Buffer.byteLength(reason)} 字节`);
    assert.equal(reason, "终".repeat(41));
  });

  it("路径不是站内绝对路径时回 invalid_request，不去连本机", () => {
    // 前者会被解析成主机名的一部分（`ws://127.0.0.1:19688@evil.com/x` 的主机就是 evil.com），
    // 后者会把凭证带到另一台主机上
    for (const path of ["@evil.example/x", "//evil.example/x"]) {
      const harness = createHarness(undefined, {
        frame: { ...FRAME, path },
      });
      assert.equal(harness.connection(), null, `${path} 不应该建连`);
      assert.equal(harness.errors[0]?.code, "invalid_request");
    }
  });

  it("下游发不动时停读本机，写完再继续（背压）", async () => {
    let release = (): void => undefined;
    const harness = createHarness(undefined, {
      onDataPending: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    harness.socket.emitOpen();
    harness.socket.emitMessage(new TextEncoder().encode("out"));
    assert.equal(harness.socket.paused, true);

    release();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(harness.socket.paused, false);
  });

  it("本机以 HTTP 拒绝升级时带上状态码（供上层映射成关闭码）", () => {
    const harness = createHarness();
    harness.socket.emitUnexpectedResponse(401);
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.errors[0]?.code, "local_rejected");
    assert.equal(harness.errorStatus[0], 401);
  });

  it("建连抛错按本机不可达上报", () => {
    const harness = createHarness(() => {
      throw new Error("ECONNREFUSED");
    });
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.errors[0]?.code, "local_unreachable");
  });

  it("建连前上行超过缓冲上限就断开并上报", () => {
    const harness = createHarness();
    harness.handle.writeBody(new Uint8Array(1024 * 1024));
    harness.handle.writeBody(new Uint8Array(1024));

    assert.equal(harness.socket.terminated, true);
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.errors[0]?.code, "local_failed");
  });

  it("abort 直接断开本机 socket，不再回调", () => {
    const harness = createHarness();
    harness.socket.emitOpen();
    harness.handle.abort("隧道断开");
    assert.equal(harness.socket.terminated, true);

    harness.socket.emitClose(1006);
    assert.deepEqual(harness.closes, []);
  });
});
