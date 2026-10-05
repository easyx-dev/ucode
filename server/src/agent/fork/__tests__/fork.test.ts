/**
 * 会话分叉文件层单测：分叉点提取、来源链接、非法点的失败关闭。
 *
 * 用真实的 `SessionManager` 在临时目录里造会话文件，不依赖模型与网络；
 * 输出文件与源文件同目录（open 时省略 sessionDir，由 pi 从源文件父目录派生）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES } from "@ucode/contracts";

import type { SessionRecord } from "../../../db/session-repository";
import { AppError } from "../../../lib/response";
import { createForkedSessionFile, resolveForkSource } from "../index";

const CWD = "/tmp/fork-project";

describe("createForkedSessionFile", () => {
  let dir: string;
  let sourcePath: string;
  let firstEntryId: string;
  let setupEntryId: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "session-fork-"));
    const manager = SessionManager.create(CWD, dir, { id: "src-session" });
    setupEntryId = manager.appendThinkingLevelChange("high");
    firstEntryId = manager.appendMessage({ role: "user", content: "第一条", timestamp: 1 });
    manager.appendMessage({ role: "user", content: "第二条", timestamp: 2 });
    const path = manager.getSessionFile();
    assert.ok(path, "源会话应已落盘");
    sourcePath = path;
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("缺省从当前叶子分叉：新会话含全部对话且指向源文件", () => {
    const forked = createForkedSessionFile({ sourcePath, cwd: CWD });
    assert.notEqual(forked.id, "src-session");

    const reopened = SessionManager.open(forked.sourcePath);
    const messages = reopened
      .getBranch()
      .filter((entry) => entry.type === "message" && entry.message.role === "user");
    assert.equal(messages.length, 2);
    assert.equal(reopened.getHeader()?.parentSession, sourcePath);
  });

  it("指定较早的条目分叉：只保留该节点及之前的历史", () => {
    const forked = createForkedSessionFile({ sourcePath, cwd: CWD, fromEntryId: firstEntryId });
    const reopened = SessionManager.open(forked.sourcePath);
    const texts = reopened
      .getBranch()
      .flatMap((entry) =>
        entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [],
      );
    assert.deepEqual(texts, ["第一条"]);
  });

  it("分叉点不存在时拒绝，不产生文件", () => {
    assert.throws(
      () => createForkedSessionFile({ sourcePath, cwd: CWD, fromEntryId: "ghost" }),
      /分叉点不存在/,
    );
  });

  it("分叉点之前还没有对话时拒绝", () => {
    assert.throws(
      () => createForkedSessionFile({ sourcePath, cwd: CWD, fromEntryId: setupEntryId }),
      /还没有对话内容/,
    );
  });
});

describe("resolveForkSource", () => {
  const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    id: "src",
    name: null,
    cwd: "/tmp/project",
    model: null,
    thinkingLevel: null,
    mode: "build",
    permissionMode: null,
    parentSessionId: null,
    agent: null,
    forkedFromId: null,
    goalState: null,
    childCount: 0,
    sourcePath: "/tmp/src.jsonl",
    preview: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...over,
  });

  const codeOf = (source: SessionRecord | undefined, active = false): string | undefined => {
    try {
      resolveForkSource("src", source, active);
      return undefined;
    } catch (error) {
      return error instanceof AppError ? error.code : "unexpected";
    }
  };

  it("源不存在或已归档都按 not_found 拒绝", () => {
    assert.equal(codeOf(undefined), ERROR_CODES.notFound);
    assert.equal(codeOf(record({ deletedAt: "2026-02-01T00:00:00.000Z" })), ERROR_CODES.notFound);
  });

  it("子智能体会话不能作为分叉源", () => {
    assert.equal(codeOf(record({ parentSessionId: "p1" })), ERROR_CODES.invalidRequest);
    assert.equal(codeOf(record({ agent: "explore" })), ERROR_CODES.invalidRequest);
  });

  it("源在跑 / 未落盘分别给出 session_busy 与 invalid_request", () => {
    assert.equal(codeOf(record(), true), ERROR_CODES.sessionBusy);
    assert.equal(codeOf(record({ sourcePath: null })), ERROR_CODES.invalidRequest);
  });

  it("可分叉时返回记录，且 sourcePath 确定为非空", () => {
    const source = resolveForkSource("src", record(), false);
    assert.equal(source.id, "src");
    assert.equal(source.sourcePath, "/tmp/src.jsonl");
  });
});
