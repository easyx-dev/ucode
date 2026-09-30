/** 会话工作区单测：目录派生、路径穿越拦截与孤儿清理 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { cleanOrphanWorkspaces, ensureWorkspaceDir, workspaceDirOf } from "../index";

describe("会话工作区", () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "workspace-test-"));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("ensureWorkspaceDir 建出工作区目录本身", () => {
    ensureWorkspaceDir("ws-1", root);
    assert.ok(existsSync(join(root, "ws-1")));
  });

  it("重复 ensure 幂等，已有内容不被清掉", () => {
    const dir = join(root, "ws-2");
    ensureWorkspaceDir("ws-2", root);
    mkdirSync(join(dir, "report"), { recursive: true });
    ensureWorkspaceDir("ws-2", root);
    assert.ok(existsSync(join(dir, "report")));
  });

  it("会话 id 含路径穿越时拒绝", () => {
    for (const bad of ["../escape", "a/b", "..", ".hidden", "a\\b", ""]) {
      assert.throws(() => workspaceDirOf(bad, root), /非法的会话 id/);
      assert.throws(() => ensureWorkspaceDir(bad, root), /非法的会话 id/);
    }
  });

  it("cleanOrphanWorkspaces 只清没有对应会话行的目录", () => {
    // 用独立子目录，避免受同文件里其他用例建出的目录影响
    const orphanRoot = join(mkdtempSync(join(tmpdir(), "workspace-orphan-")), "root");
    ensureWorkspaceDir("alive", orphanRoot);
    ensureWorkspaceDir("orphan", orphanRoot);

    const removed = cleanOrphanWorkspaces({ keepIds: ["alive"], root: orphanRoot });

    assert.deepEqual(removed, ["orphan"]);
    assert.ok(existsSync(join(orphanRoot, "alive")));
    assert.equal(existsSync(join(orphanRoot, "orphan")), false);
  });

  it("工作区根不存在时不抛错", () => {
    assert.deepEqual(cleanOrphanWorkspaces({ keepIds: [], root: join(root, "nope") }), []);
  });
});
