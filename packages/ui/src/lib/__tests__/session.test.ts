/**
 * 会话标题、未读判定与归档确认文案的单测。
 *
 * 归档确认走 `lib/dialog` 的队列：这里只验队列里的请求内容（标题 / 说明按子会话分支），
 * 不做渲染——渲染由 `business/confirm-dialog` 负责。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SessionSummary } from "@ucode/contracts";
import type { TFunction } from "i18next";

import {
  type ConfirmOptions,
  type DialogRequest,
  dialogHead,
  registerDialogHost,
  settleDialog,
  settlePendingDialogs,
} from "../dialog";
import { confirmArchiveSession, isSessionUnread, sessionTitle } from "../session";

/**
 * 替身 t：i18next 缺 key 时回退为 key 本身并插值，这里照同口径处理，
 * 断言看的就是用户真正见到的中文。
 */
const translate = ((key: string, options?: Record<string, unknown>) =>
  options
    ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))
    : key) as unknown as TFunction;

const sessionOf = (patch: Partial<SessionSummary> = {}): SessionSummary =>
  ({ id: "s1", cwd: "/tmp", preview: "", childCount: 0, ...patch }) as SessionSummary;

/** 队首请求：用例里断言过存在，这里只做一次收窄 */
const head = (): DialogRequest => {
  const request = dialogHead();
  assert.ok(request, "队列应有队首");
  return request;
};

/** 队首的确认框描述 */
const confirmOptions = (): ConfirmOptions => {
  const request = head();
  assert.equal(request.kind, "confirm");
  if (request.kind !== "confirm") throw new Error("队列里应是确认框");
  return request.options;
};

let unregisterHost = (): void => {};

beforeEach(() => {
  unregisterHost = registerDialogHost();
});

afterEach(() => {
  unregisterHost();
});

describe("会话标题", () => {
  it("优先命名，其次首条消息，最后兜底", () => {
    assert.equal(sessionTitle(sessionOf({ name: "起过名字" }), "新会话"), "起过名字");
    assert.equal(sessionTitle(sessionOf({ preview: "先问一句\n再说" }), "新会话"), "先问一句");
    assert.equal(sessionTitle(sessionOf(), "新会话"), "新会话");
  });

  it("未读：没读过即未读，生成中不算", () => {
    assert.equal(isSessionUnread(sessionOf()), true);
    assert.equal(isSessionUnread(sessionOf({ running: true })), false);
    assert.equal(
      isSessionUnread(
        sessionOf({ lastReadAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
      ),
      false,
    );
  });
});

describe("归档确认", () => {
  it("无子会话：只提示会从列表隐藏", async () => {
    const asked = confirmArchiveSession(sessionOf({ name: "普通会话" }), translate);
    const options = confirmOptions();
    assert.equal(options.title, "归档会话「普通会话」？");
    assert.equal(options.description, "会话会从列表里隐藏，对话与文件都保留。");
    assert.equal(options.confirmText, "归档");

    settlePendingDialogs();
    assert.equal(await asked, false);
  });

  it("有子会话：说明会级联归档", async () => {
    const asked = confirmArchiveSession(sessionOf({ name: "带子会话", childCount: 2 }), translate);
    assert.equal(confirmOptions().description, "它的子会话会一并归档，对话与文件都保留。");

    settlePendingDialogs();
    assert.equal(await asked, false);
  });

  it("确认返回 true，取消返回 false", async () => {
    const confirmed = confirmArchiveSession(sessionOf(), translate);
    settleDialog(head(), true);
    assert.equal(await confirmed, true);

    const cancelled = confirmArchiveSession(sessionOf(), translate);
    settleDialog(head(), false);
    assert.equal(await cancelled, false);
  });
});
