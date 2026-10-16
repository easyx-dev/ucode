/** 窗口标题提示单测：等待类优先于未读、同类取最高优先、计数有上限 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionStatus, SessionSummary } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { titleNoticeOf, windowTitleOf } from "../title-notice";

/** 替身 t：缺 key 时回退为 key 本身，断言看的就是界面上真正出现的中文 */
const translate = ((key: string) => key) as unknown as TFunction;

// 品牌标题在运行时来自 `@ucode/brand`（那个包会带 .svg 资源，进不了 node 测试链路），这里只用占位
const BASE = "Base";

const session = (
  id: string,
  status: SessionStatus,
  times: { updatedAt?: string; lastReadAt?: string | null; running?: boolean } = {},
) =>
  ({
    id,
    status,
    running: times.running ?? false,
    updatedAt: times.updatedAt ?? "2026-01-01T00:00:00.000Z",
    lastReadAt: times.lastReadAt === undefined ? "2026-01-02T00:00:00.000Z" : times.lastReadAt,
  }) as SessionSummary;

describe("titleNoticeOf", () => {
  it("没有等待也没有未读时不提示", () => {
    assert.equal(titleNoticeOf([]), null);
    assert.equal(titleNoticeOf([session("a", "idle")]), null);
  });

  it("等待类优先于未读", () => {
    const notice = titleNoticeOf([
      session("a", "idle", { lastReadAt: null }),
      session("b", "waiting_plan"),
    ]);
    assert.deepEqual(notice, { kind: "waiting", status: "waiting_plan" });
  });

  it("多类同时等待时取最高优先的那个，且与会话顺序无关", () => {
    const sessions = [session("a", "waiting_plan"), session("b", "waiting_question")];
    assert.deepEqual(titleNoticeOf([...sessions, session("c", "waiting_permission")]), {
      kind: "waiting",
      status: "waiting_permission",
    });
    assert.deepEqual(titleNoticeOf(sessions), { kind: "waiting", status: "waiting_question" });
  });

  it("没有等待时数未读：正在生成的不算，从未打开与读过之后又有更新的算", () => {
    assert.deepEqual(
      titleNoticeOf([
        session("a", "running", { running: true, lastReadAt: null }),
        session("b", "idle", { lastReadAt: "2025-12-31T00:00:00.000Z" }),
        session("c", "idle", { lastReadAt: null }),
        session("d", "idle", { lastReadAt: "2026-01-03T00:00:00.000Z" }),
      ]),
      { kind: "unread", count: 2 },
    );
  });
});

describe("windowTitleOf", () => {
  it("没有提示就是品牌标题原样", () => {
    assert.equal(windowTitleOf(null, translate, BASE), BASE);
  });

  it("等待类拼状态词，未读拼括号里的条数", () => {
    assert.equal(
      windowTitleOf({ kind: "waiting", status: "waiting_permission" }, translate, BASE),
      `待审批 · ${BASE}`,
    );
    assert.equal(windowTitleOf({ kind: "unread", count: 2 }, translate, BASE), `(2) ${BASE}`);
  });

  it("条数超过上限写成 99+", () => {
    assert.equal(windowTitleOf({ kind: "unread", count: 100 }, translate, BASE), `(99+) ${BASE}`);
  });
});
