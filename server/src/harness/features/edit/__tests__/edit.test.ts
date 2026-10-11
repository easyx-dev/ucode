/**
 * 编辑点校验单测：只认活动分支上的用户消息。
 *
 * 用真实的 `SessionManager` 在临时目录里造出「已存在被放弃分支」的树，不依赖模型与网络。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES } from "@ucode/contracts";

import { AppError } from "../../../../platform/response";
import { resolveEditableUserEntry } from "..";

const CWD = "/tmp/edit-project";

describe("resolveEditableUserEntry", () => {
  let dir: string;
  let manager: SessionManager;
  let firstUserId: string;
  let abandonedUserId: string;
  let setupEntryId: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "session-edit-"));
    manager = SessionManager.create(CWD, dir, { id: "edit-session" });
    setupEntryId = manager.appendThinkingLevelChange("high");
    firstUserId = manager.appendMessage({ role: "user", content: "第一条", timestamp: 1 });

    // 从第一条用户消息再分一支：第二条落在被放弃的分支上，第三条才是活动分支
    manager.branch(firstUserId);
    abandonedUserId = manager.appendMessage({ role: "user", content: "第二条", timestamp: 2 });
    manager.branch(firstUserId);
    manager.appendMessage({ role: "user", content: "第三条", timestamp: 3 });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const codeOf = (entryId: string): string | undefined => {
    try {
      resolveEditableUserEntry(manager.getBranch(), entryId);
      return undefined;
    } catch (error) {
      return error instanceof AppError ? error.code : "unexpected";
    }
  };

  it("活动分支上的用户消息可编辑", () => {
    const entry = resolveEditableUserEntry(manager.getBranch(), firstUserId);
    assert.equal(entry.id, firstUserId);
    assert.equal(entry.message.role, "user");
  });

  it("非用户消息被拒绝", () => {
    assert.equal(codeOf(setupEntryId), ERROR_CODES.invalidRequest);
    assert.throws(
      () => resolveEditableUserEntry(manager.getBranch(), setupEntryId),
      /只能编辑用户消息/,
    );
  });

  it("不在活动分支的消息被拒绝", () => {
    assert.equal(codeOf(abandonedUserId), ERROR_CODES.invalidRequest);
    assert.throws(
      () => resolveEditableUserEntry(manager.getBranch(), abandonedUserId),
      /不在当前分支/,
    );
  });

  it("不存在的消息被拒绝", () => {
    assert.equal(codeOf("ghost"), ERROR_CODES.invalidRequest);
    assert.throws(() => resolveEditableUserEntry(manager.getBranch(), "ghost"), /不存在/);
  });
});
