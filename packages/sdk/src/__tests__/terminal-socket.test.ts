/** 终端输出流的连接管理：取票建连、断线退避重连、按关闭码判定终态 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES } from "@ucode/contracts";

import type { Apis } from "../apis";
import { ApiError } from "../error";
import {
  createTerminalSocket,
  type TerminalExit,
  type TerminalSocketLike,
} from "../terminal-socket";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 退避重连的首跳是 1s，等过它才有第二条连接 */
const RECONNECT_WAIT_MS = 1300;

/** 假 socket：由测试决定何时 open / 以什么码关闭 */
class FakeSocket implements TerminalSocketLike {
  binaryType = "";
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closedByCaller = false;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  closeWith(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  close(): void {
    this.closedByCaller = true;
    this.closeWith(1000, "client-close");
  }
}

const terminalsOf = (): Apis["terminal"] =>
  ({
    ticket: async ({ terminalId }) => ({ ticket: `t-${terminalId}`, expiresAt: "" }),
    websocketUrl: (terminalId: string, ticket: string) =>
      `ws://test/${terminalId}?ticket=${ticket}`,
  }) as Apis["terminal"];

const harness = () => {
  const sockets: FakeSocket[] = [];
  const stream = createTerminalSocket({
    terminals: terminalsOf(),
    terminalId: "term-1",
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return { sockets, stream };
};

describe("终端输出流的连接管理", () => {
  it("取票后按地址建连，首次连接不触发 onReconnect", async () => {
    const { sockets, stream } = harness();
    let opened = 0;
    let reconnects = 0;
    stream.onOpen(() => {
      opened += 1;
    });
    stream.onReconnect(() => {
      reconnects += 1;
    });

    stream.start();
    await delay(10);
    assert.equal(sockets.length, 1);
    assert.match(sockets[0]?.url ?? "", /ticket=t-term-1/);

    sockets[0]?.open();
    assert.equal(opened, 1);
    assert.equal(sockets[0]?.url, "ws://test/term-1?ticket=t-term-1");
    assert.equal(reconnects, 0);
    stream.stop();
  });

  it("异常断开后重连，第二次连上才触发 onReconnect", async () => {
    const { sockets, stream } = harness();
    let reconnects = 0;
    stream.onOpen(() => {});
    stream.onReconnect(() => {
      reconnects += 1;
    });

    stream.start();
    await delay(10);
    sockets[0]?.open();
    // 1006：网络断了，不是终态
    sockets[0]?.closeWith(1006);

    await delay(RECONNECT_WAIT_MS);
    assert.equal(sockets.length, 2);
    sockets[1]?.open();
    assert.equal(reconnects, 1);
    stream.stop();
  });

  it("进程结束的关闭码带出退出码，且不再重连", async () => {
    const { sockets, stream } = harness();
    const exits: TerminalExit[] = [];
    stream.onExit((exit) => exits.push(exit));

    stream.start();
    await delay(10);
    sockets[0]?.open();
    sockets[0]?.closeWith(1000, "exit:3");

    await delay(RECONNECT_WAIT_MS);
    assert.deepEqual(exits, [{ kind: "exit", exitCode: 3 }]);
    assert.equal(sockets.length, 1);
  });

  it("票据失效 / 终端不存在都按终态收场，且带出是哪一种", async () => {
    const cases = [
      { code: 4401, kind: "unauthorized" },
      { code: 4404, kind: "gone" },
    ] as const;
    for (const { code, kind } of cases) {
      const { sockets, stream } = harness();
      const exits: TerminalExit[] = [];
      stream.onExit((exit) => exits.push(exit));

      stream.start();
      await delay(10);
      sockets[0]?.open();
      sockets[0]?.closeWith(code);

      await delay(RECONNECT_WAIT_MS);
      assert.deepEqual(exits, [{ kind }], `码 ${code} 应判终态`);
      assert.equal(sockets.length, 1, `码 ${code} 不该重连`);
      stream.stop();
    }
  });

  it("取票被判终态（终端已不存在 / 凭证失效）时不再重连", async () => {
    const cases = [
      { code: ERROR_CODES.terminalNotFound, kind: "gone" },
      { code: ERROR_CODES.unauthorized, kind: "unauthorized" },
    ] as const;
    for (const { code, kind } of cases) {
      const sockets: FakeSocket[] = [];
      const exits: TerminalExit[] = [];
      const stream = createTerminalSocket({
        terminals: {
          ticket: async () => {
            throw new ApiError(code, "取不到票", { httpStatus: 404 });
          },
          websocketUrl: () => "ws://test/never",
        } as unknown as Apis["terminal"],
        terminalId: "term-1",
        createSocket: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        },
      });
      stream.onExit((exit) => exits.push(exit));

      stream.start();
      await delay(RECONNECT_WAIT_MS);
      assert.deepEqual(exits, [{ kind }], `码 ${code} 应判终态`);
      assert.equal(sockets.length, 0, `码 ${code} 不该建连`);
    }
  });

  it("取票遇到普通失败（服务没起）仍退避重连", async () => {
    const sockets: FakeSocket[] = [];
    let attempts = 0;
    const stream = createTerminalSocket({
      terminals: {
        ticket: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("network down");
          return { ticket: "t", expiresAt: "" };
        },
        websocketUrl: () => "ws://test/recovered",
      } as unknown as Apis["terminal"],
      terminalId: "term-1",
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    stream.start();
    await delay(RECONNECT_WAIT_MS);
    assert.equal(sockets.length, 1);
    stream.stop();
  });

  it("stop 之后不再重连", async () => {
    const { sockets, stream } = harness();
    stream.onOpen(() => {});
    stream.start();
    await delay(10);
    sockets[0]?.open();
    stream.stop();

    await delay(RECONNECT_WAIT_MS);
    assert.equal(sockets.length, 1);
  });
});
