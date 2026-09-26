import type { ServerMessage } from "@ucode/protocol";
import { describe, expect, it } from "vitest";
import { applyServerMessage, createInitialState, toDisplayMessages } from "./reducer.ts";

/**
 * 事件折叠的单元测试（spec §4.5 的三条不变量）。
 *
 * 这些性质在真实运行里都出过问题或差点出问题：重复投递、增量与权威的顺序、
 * 侧栏计数落后。放在这里做回归，比端到端更快定位。
 */

const welcome = (sessions: { id: string; entryCount: number }[] = []): ServerMessage => ({
  type: "welcome",
  protocolVersion: 1,
  coreId: "core-1",
  capabilities: ["sessions.read", "prompt.run"],
  grantedCapabilities: ["sessions.read", "prompt.run"],
  trustLevel: "local",
  dataLayerVersion: 1,
  sessions: sessions.map((session) => ({
    id: session.id,
    cwd: "/tmp",
    name: null,
    file: `/tmp/${session.id}.jsonl`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: session.entryCount,
    firstMessage: null,
    owned: false,
    archived: false,
  })),
  resumeAck: null,
});

const userEntry = (id: string, seq: number, text: string): ServerMessage => ({
  type: "entry_appended",
  sessionId: "s1",
  seq,
  entry: {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  },
});

describe("事件折叠", () => {
  it("握手：连接状态、信任级别与能力授予被记录", () => {
    const state = applyServerMessage(createInitialState(), welcome(), 0);
    expect(state.connected).toBe(true);
    expect(state.coreId).toBe("core-1");
    expect(state.trustLevel).toBe("local");
    expect(state.grantedCapabilities).toEqual(["sessions.read", "prompt.run"]);
  });

  it("记录去重：重放/续传重复投递同一条记录不产生重复行", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(state, userEntry("e1", 1, "第一句"), 1);
    state = applyServerMessage(state, userEntry("e1", 1, "第一句"), 2);
    expect(state.views.s1?.entries.length).toBe(1);
    expect(state.views.s1?.maxSeq).toBe(1);
  });

  it("乱序到达：按 seq 插入正确位置", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(state, userEntry("e2", 2, "第二句"), 1);
    state = applyServerMessage(state, userEntry("e1", 1, "第一句"), 2);
    expect(state.views.s1?.entries.map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });

  it("权威记录到达：清掉非权威的流式尾巴", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(
      state,
      { type: "message_delta", sessionId: "s1", kind: "text", delta: "正在", index: 0 },
      1,
    );
    expect(state.views.s1?.streaming.text).toBe("正在");
    expect(
      toDisplayMessages(state.views.s1 as never).some((message) => message.streaming === true),
    ).toBe(true);

    state = applyServerMessage(state, userEntry("e1", 1, "落盘的内容"), 2);
    expect(state.views.s1?.streaming.text).toBe("");
  });

  it("一轮结束不等于完成：running 只在 agent_settled 落下", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(state, { type: "turn_start", sessionId: "s1" }, 1);
    expect(state.views.s1?.running).toBe(true);
    state = applyServerMessage(
      state,
      { type: "turn_end", sessionId: "s1", entryId: "e1", toolResultIds: [] },
      2,
    );
    expect(state.views.s1?.running, "turn_end 不应解除运行中").toBe(true);
    state = applyServerMessage(state, { type: "agent_settled", sessionId: "s1" }, 3);
    expect(state.views.s1?.running).toBe(false);
  });

  it("摘要随记录更新（侧栏计数与首条消息不再落后）", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(state, userEntry("e1", 1, "侧栏应该看到这句"), 1);
    expect(state.sessions.find((session) => session.id === "s1")?.entryCount).toBe(1);
    expect(state.sessions.find((session) => session.id === "s1")?.firstMessage).toBe(
      "侧栏应该看到这句",
    );
    expect(state.views.s1?.summary?.firstMessage).toBe("侧栏应该看到这句");
  });

  it("游标失效：显式信号触发重新全量同步", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    state = applyServerMessage(state, userEntry("e1", 1, "旧的"), 1);
    state = applyServerMessage(
      state,
      { type: "resync_required", sessionId: "s1", reason: "migration", cursor: 0 },
      2,
    );
    expect(state.views.s1?.entries.length).toBe(0);
    expect(state.views.s1?.needsResync).toBe(true);
  });

  it("交互：ui.request 入列，ui.cancel 出列", () => {
    let state = applyServerMessage(createInitialState(), welcome([{ id: "s1", entryCount: 0 }]), 0);
    const request = {
      type: "ui.request" as const,
      id: "ui-1",
      sessionId: "s1",
      method: "confirm" as const,
      params: { title: "允许？", message: "要写文件" },
      origin: "permission" as const,
    };
    state = applyServerMessage(state, request, 1);
    expect(state.interactions.length).toBe(1);
    state = applyServerMessage(state, { type: "ui.cancel", id: "ui-1", reason: "answered" }, 2);
    expect(state.interactions.length).toBe(0);
  });
});
