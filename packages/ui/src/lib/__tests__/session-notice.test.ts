/** 会话通知判定单测：状态游标保证同一状态只通知一次，页面可见时不打扰 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionStatus, SessionSummary } from "@ucode/contracts";

import { collectNotices, type NoticeCursor, noticeOf, shouldNotify } from "../session-notice";

const session = (id: string, status: SessionStatus, parentSessionId: string | null = null) =>
  ({ id, status, parentSessionId }) as SessionSummary;

describe("noticeOf", () => {
  it("首次见到会话只建立基线", () => {
    assert.equal(noticeOf(undefined, session("a", "waiting_permission")), null);
  });

  it("等待授权 / 回答 / 计划确认各自成一类", () => {
    assert.equal(noticeOf("running", session("a", "waiting_permission")), "waiting_permission");
    assert.equal(noticeOf("running", session("a", "waiting_question")), "waiting_question");
    assert.equal(noticeOf("running", session("a", "waiting_plan")), "waiting_plan");
  });

  it("状态没变不通知；同一状态重复到达也只算一次", () => {
    assert.equal(noticeOf("running", session("a", "running")), null);
    assert.equal(noticeOf("waiting_question", session("a", "waiting_question")), null);
  });

  it("从中间态落定算任务完成，出错另行通知", () => {
    assert.equal(noticeOf("running", session("a", "idle")), "done");
    assert.equal(noticeOf("waiting_permission", session("a", "idle")), "done");
    assert.equal(noticeOf("running", session("a", "error")), "error");
    assert.equal(noticeOf("idle", session("a", "idle")), null);
  });

  it("子会话落定不算任务完成，但等输入与出错照常通知", () => {
    assert.equal(noticeOf("running", session("child", "idle", "root")), null);
    assert.equal(
      noticeOf("running", session("child", "waiting_permission", "root")),
      "waiting_permission",
    );
    assert.equal(noticeOf("running", session("child", "error", "root")), "error");
  });
});

describe("shouldNotify", () => {
  it("页面可见时不打扰，开关关掉也不通知", () => {
    assert.equal(shouldNotify({ enabled: true, pageVisible: true }), false);
    assert.equal(shouldNotify({ enabled: false, pageVisible: false }), false);
    assert.equal(shouldNotify({ enabled: true, pageVisible: false }), true);
  });
});

describe("collectNotices", () => {
  it("同一状态变化只通知一次，游标随之前进", () => {
    let cursor: NoticeCursor = new Map();
    const running = collectNotices(cursor, [session("a", "running")]);
    assert.deepEqual(running.notices, []);
    cursor = running.cursor;

    cursor = collectNotices(cursor, [session("a", "running")]).cursor;
    const waiting = collectNotices(cursor, [session("a", "waiting_question")]);
    assert.deepEqual(
      waiting.notices.map((notice) => notice.kind),
      ["waiting_question"],
    );
    cursor = waiting.cursor;

    const again = collectNotices(cursor, [session("a", "waiting_question")]);
    assert.deepEqual(again.notices, []);
    assert.deepEqual(
      collectNotices(again.cursor, [session("a", "idle")]).notices.map((notice) => notice.kind),
      ["done"],
    );
  });

  it("游标只保留当前存在的会话，归档后不再累积", () => {
    const first = collectNotices(new Map(), [session("a", "running"), session("b", "running")]);
    const second = collectNotices(first.cursor, [session("a", "idle")]);
    assert.deepEqual([...second.cursor.keys()], ["a"]);
    assert.deepEqual(
      second.notices.map((notice) => notice.sessionId),
      ["a"],
    );
  });
});
