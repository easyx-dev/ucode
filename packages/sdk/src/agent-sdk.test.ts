import type { Transport } from "@ucode/protocol";
import { describe, expect, it } from "vitest";
import { connect } from "./agent-sdk.ts";

/**
 * 用**假传输**驱动 sdk：协议消息完全可控，专测连接与握手时序。
 *
 * 这里钉着一个真实出现过的缺陷：初次连接时，服务端的 `stream.ready` 可能先于
 * hello 的 welcome 到达——sdk 曾把它当成"断线重连"又发起一次握手，两个等待者
 * 抢一条 welcome，其中一个永远等不到（表现为 connect 后 `connected === false`）。
 */

const WELCOME = {
  type: "welcome",
  protocolVersion: 1,
  coreId: "core-test",
  capabilities: ["sessions.read"],
  grantedCapabilities: ["sessions.read"],
  trustLevel: "local",
  dataLayerVersion: 1,
  sessions: [],
  resumeAck: null,
};

type FakeTransport = Transport & {
  /** 测试注入：模拟核心层发来一条原始消息。 */
  emit(raw: unknown): void;
  /** 测试注入：模拟事件流断开。 */
  break(reason: string): void;
  sent: unknown[];
};

/** 让微任务与定时器都跑完（握手链上既有微任务也有 setTimeout）。 */
const drain = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function makeFakeTransport(): FakeTransport {
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const sent: unknown[] = [];
  let readyResolve: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const transport: FakeTransport = {
    kind: "http",
    sent,
    send(message) {
      sent.push(message);
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    onError() {},
    async close() {
      closeHandlers.length = 0;
    },
    ready: () => ready,
    emit(raw) {
      for (const handler of messageHandlers) handler(raw);
    },
    break(reason) {
      for (const handler of closeHandlers) handler(reason);
    },
  };
  readyResolve?.();
  return transport;
}

describe("sdk 连接与握手时序", () => {
  it("初次连接：stream.ready 先到也不重复握手，connected 立即为真", async () => {
    const transport = makeFakeTransport();
    // 真实时序：connect() 发出 hello；服务端在 welcome 之前先推 stream.ready（流本来就开着）
    const agent = await connect({
      transport,
      clientId: "t1",
      clientKind: "test",
      capabilities: ["sessions.read"],
    });
    const connectPromise = agent.connect();
    await drain();

    // 初次连接阶段，stream.ready 是常态（流本来就开着），不应触发第二次握手
    transport.emit({ type: "stream.ready", coreId: "core-test" });
    await drain();
    transport.emit(WELCOME);
    const sdk = await agent;

    const helloCount = transport.sent.filter(
      (message) => (message as { type: string }).type === "hello",
    ).length;
    expect(helloCount, "stream.ready 不应引发第二次 hello").toBe(1);
    expect(sdk.state.connected).toBe(true);
    await sdk.close();
  });

  it("断线重连：stream.ready 触发带游标的重新握手", async () => {
    const transport = makeFakeTransport();
    const agent = await connect({
      transport,
      clientId: "t2",
      clientKind: "test",
      capabilities: ["sessions.read"],
      resume: { sessionId: "s1", fromSeq: 7 },
    });
    const connectPromise = agent.connect();
    await drain();
    transport.emit(WELCOME);
    const sdk = await agent;
    expect(sdk.state.connected).toBe(true);

    // 现实中断线与重连之间隔着至少一个重试间隔；这里用真实延时表示
    await new Promise((resolve) => setTimeout(resolve, 5));
    // 断线（close handler 触发）→ 重开流（stream.ready）→ 应重新握手并带上游标
    transport.break("事件流中断");
    transport.emit({ type: "stream.ready", coreId: "core-test" });
    await drain();

    const hellos = transport.sent.filter(
      (message) => (message as { type: string }).type === "hello",
    );
    expect(hellos.length).toBe(2);
    const resume = (hellos[1] as { resume?: { sessionId: string; fromSeq: number } }).resume;
    expect(resume).toEqual({ sessionId: "s1", fromSeq: 7 });
    await sdk.close();
  });
});
