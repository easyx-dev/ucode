/** 会话仓储单测：模式与工作区覆盖值的持久化口径 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { openDatabase } from "../index";
import { SessionRepository } from "../session-repository";

describe("SessionRepository 覆盖值", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  let repo: SessionRepository;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "session-repo-"));
    db = openDatabase(join(dir, "app.db"));
    repo = new SessionRepository(db);
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("未指定模式的新会话回落默认 build", () => {
    repo.create("s1", {});
    assert.equal(repo.find("s1")?.mode, "build");
  });

  it("模式与工作区可写入并读回", () => {
    repo.create("s2", { mode: "ask", workspaceDir: "/workspace/s2" });
    const record = repo.find("s2");
    assert.equal(record?.mode, "ask");
    assert.equal(record?.workspaceDir, "/workspace/s2");
  });

  it("set 只覆盖显式给出的字段", () => {
    repo.create("s3", { mode: "plan" });
    repo.set("s3", { name: "改个名" });
    const record = repo.find("s3");
    assert.equal(record?.name, "改个名");
    assert.equal(record?.mode, "plan");
  });

  it("非法模式按默认值兜底", () => {
    repo.create("s4", {});
    // 绕过写入层直接塞脏值，模拟手工改库
    db.prepare("UPDATE session SET mode = ? WHERE id = ?").run("nonsense", "s4");
    assert.equal(repo.find("s4")?.mode, "build");
  });
});
