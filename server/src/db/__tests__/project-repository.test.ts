/** db/project-repository：按路径 upsert、写回只覆盖给到的字段、非法枚举留给上层回落 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openDatabase } from "../index";
import { ProjectRepository } from "../project-repository";

const created: string[] = [];

const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "project-repo-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return { repo: new ProjectRepository(db), close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ProjectRepository", () => {
  it("ensure 登记一行且只登记一次，重复调用不改原有值", () => {
    const env = makeRepo();
    try {
      env.repo.ensure("/work/a");
      const first = env.repo.find("/work/a");
      assert.ok(first);
      assert.equal(first.name, null);
      assert.equal(first.model, null);

      env.repo.setName("/work/a", "项目甲");
      env.repo.ensure("/work/a");
      assert.equal(env.repo.find("/work/a")?.name, "项目甲");
      assert.equal(env.repo.find("/work/a")?.id, first.id);
    } finally {
      env.close();
    }
  });

  it("setName 支持补建与显式清空", () => {
    const env = makeRepo();
    try {
      env.repo.setName("/work/old", "老项目");
      assert.equal(env.repo.find("/work/old")?.name, "老项目");

      env.repo.setName("/work/old", null);
      assert.equal(env.repo.find("/work/old")?.name, null);
    } finally {
      env.close();
    }
  });

  it("rememberDefaults 只覆盖这次给到的字段", () => {
    const env = makeRepo();
    try {
      env.repo.rememberDefaults("/work/a", {
        model: "p/m1",
        thinkingLevel: "xhigh",
        mode: "plan",
        permissionMode: "auto",
      });
      env.repo.rememberDefaults("/work/a", { model: "p/m2" });

      const record = env.repo.find("/work/a");
      assert.equal(record?.model, "p/m2");
      assert.equal(record?.thinkingLevel, "xhigh");
      assert.equal(record?.mode, "plan");
      assert.equal(record?.permissionMode, "auto");
    } finally {
      env.close();
    }
  });

  it("rememberDefaults 在行不存在时补建，且不改名", () => {
    const env = makeRepo();
    try {
      env.repo.setName("/work/b", "项目乙");
      env.repo.rememberDefaults("/work/b", { mode: "ask" });

      const record = env.repo.find("/work/b");
      assert.equal(record?.name, "项目乙");
      assert.equal(record?.mode, "ask");
    } finally {
      env.close();
    }
  });

  it("list 与 find 同口径，两行都回得来", () => {
    const env = makeRepo();
    try {
      env.repo.ensure("/work/a");
      env.repo.ensure("/work/b");

      assert.deepEqual(
        env.repo
          .list()
          .map((record) => record.path)
          .sort(),
        ["/work/a", "/work/b"],
      );
      for (const path of ["/work/a", "/work/b"]) {
        assert.deepEqual(
          env.repo.list().find((record) => record.path === path),
          env.repo.find(path),
        );
      }
    } finally {
      env.close();
    }
  });

  it("deleteOrphans 只删没有被会话引用的行", () => {
    const env = makeRepo();
    try {
      env.repo.setName("/work/alive", "在用的");
      env.repo.setName("/work/gone", "改了目录名的");

      assert.deepEqual(env.repo.deleteOrphans(["/work/alive"]), ["/work/gone"]);
      assert.equal(env.repo.find("/work/alive")?.name, "在用的");
      assert.equal(env.repo.find("/work/gone"), undefined);
      // 没有要保留的路径时全部清掉，且不需要无条件 DELETE 语句
      // （返回顺序取自 `list()`，同毫秒创建的行之间不保证先后，断言前排序）
      env.repo.ensure("/work/other");
      assert.deepEqual(env.repo.deleteOrphans([]).sort(), ["/work/alive", "/work/other"]);
      assert.deepEqual(env.repo.list(), []);
    } finally {
      env.close();
    }
  });
});
