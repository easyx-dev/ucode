/** 会话状态的判定口径：待答请求优先于「生成中」，其次才是出错与计划待确认 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type SessionStatusSources, sessionStatusOf } from "../session-status";

const sources = (patch: Partial<SessionStatusSources> = {}): SessionStatusSources => ({
  active: false,
  errored: false,
  pending: [],
  planPending: false,
  ...patch,
});

describe("sessionStatusOf", () => {
  it("没有活跃生成与挂起请求时是已完成", () => {
    assert.equal(sessionStatusOf(sources()), "idle");
  });

  it("等待授权与等待回答分别独立成态", () => {
    assert.equal(sessionStatusOf(sources({ pending: ["permission"] })), "waiting_permission");
    assert.equal(sessionStatusOf(sources({ pending: ["question"] })), "waiting_question");
  });

  it("两类请求同时挂着时按「需要更确定的动作」优先，取授权", () => {
    assert.equal(
      sessionStatusOf(sources({ pending: ["question", "permission"] })),
      "waiting_permission",
    );
  });

  it("挂起请求优先于生成中：这一轮其实停在用户身上", () => {
    assert.equal(
      sessionStatusOf(sources({ active: true, pending: ["permission"] })),
      "waiting_permission",
    );
    assert.equal(sessionStatusOf(sources({ active: true })), "running");
  });

  it("本轮出错排在计划待确认之前，两者不同时为真时各自成立", () => {
    assert.equal(sessionStatusOf(sources({ errored: true })), "error");
    assert.equal(sessionStatusOf(sources({ planPending: true })), "waiting_plan");
    assert.equal(sessionStatusOf(sources({ errored: true, planPending: true })), "error");
  });

  it("计划待确认要有 plan 模式的本轮收尾，出错优先于它", () => {
    assert.equal(sessionStatusOf(sources({ planPending: true, active: true })), "running");
  });
});
