/** 事件总线：message_end 一帧的条目 id 由总线在落盘后补上 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ServerEvent } from "@ucode/contracts";

import { SessionEventBus } from "../event-bus";

/** 只实现总线用到的部分：订阅、档位、分支查询 */
const fakeSession = (options: { entries: { type: "message"; id: string; message: unknown }[] }) => {
  let listener: ((event: unknown) => void) | null = null;
  const session = {
    thinkingLevel: "off",
    sessionManager: { getBranch: () => options.entries },
    subscribe: (handler: (event: unknown) => void) => {
      listener = handler;
      return () => {
        listener = null;
      };
    },
  } as unknown as AgentSession;

  return {
    session,
    setBranch: (entries: { type: "message"; id: string; message: unknown }[]) => {
      options.entries = entries;
    },
    emit: (event: unknown) => listener?.(event),
  };
};

const messageIdOf = (frames: ServerEvent[]): unknown => {
  const frame = frames.find((item) => item.type === "message_end");
  return frame && "data" in frame ? (frame.data as { id?: unknown }).id : undefined;
};

describe("SessionEventBus 的 message_end", () => {
  it("推迟到落盘之后发帧，带上真实条目 id", async () => {
    const message = { role: "user", content: [{ type: "text", text: "看这个" }] };
    const fake = fakeSession({ entries: [] });
    const bus = new SessionEventBus();
    const frames: ServerEvent[] = [];
    bus.subscribe((frame) => frames.push(frame));
    bus.attach("s1", fake.session);

    // pi 的顺序：先发事件，再把消息落盘（这里模拟成同步 appendMessage）
    fake.emit({ type: "message_end", message });
    assert.equal(frames.length, 0, "落盘前不该发帧");
    fake.setBranch([{ type: "message", id: "e7f1", message }]);
    await Promise.resolve();

    assert.equal(messageIdOf(frames), "e7f1");
  });

  it("查不到条目（落盘失败）时退回临时 id，不丢这一帧", async () => {
    const fake = fakeSession({ entries: [] });
    const bus = new SessionEventBus();
    const frames: ServerEvent[] = [];
    bus.subscribe((frame) => frames.push(frame));
    bus.attach("s1", fake.session);

    fake.emit({ type: "message_end", message: { role: "user", content: [] } });
    await Promise.resolve();

    assert.match(String(messageIdOf(frames)), /^live-\d+-[0-9a-f]+$/);
  });
});
