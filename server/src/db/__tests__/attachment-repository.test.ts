/** db/attachment-repository：内容寻址元数据的读写、引用标记与过期删除 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { AttachmentRepository } from "../attachment-repository";
import { openDatabase } from "../index";

const created: string[] = [];

const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "att-repo-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return { repo: new AttachmentRepository(db), close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("AttachmentRepository", () => {
  const id = "a".repeat(64);
  const base = { mimeType: "application/pdf", name: "report.pdf", size: 12, referencedAt: null };

  it("写入后可读回", () => {
    const env = makeRepo();
    try {
      env.repo.insert({ id, ...base, createdAt: "2026-01-01T00:00:00.000Z" });
      assert.deepEqual(env.repo.find(id), {
        id,
        ...base,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      env.close();
    }
  });

  it("同 id 重复写入保留首条（内容寻址去重）", () => {
    const env = makeRepo();
    try {
      env.repo.insert({ id, ...base, name: "a.pdf", createdAt: "t1" });
      env.repo.insert({ id, ...base, name: "b.pdf", createdAt: "t2" });
      assert.equal(env.repo.find(id)?.name, "a.pdf");
    } finally {
      env.close();
    }
  });

  it("markReferenced 幂等：只把空值置为首次引用时间", () => {
    const env = makeRepo();
    try {
      env.repo.insert({ id, ...base, createdAt: "t1" });
      env.repo.markReferenced([id], "t2");
      env.repo.markReferenced([id], "t3");
      assert.equal(env.repo.find(id)?.referencedAt, "t2");
    } finally {
      env.close();
    }
  });

  it("deleteExpired 只删未引用且早于阈值的行", () => {
    const env = makeRepo();
    try {
      env.repo.insert({ id, ...base, createdAt: "2026-01-01T00:00:00.000Z" }); // 未引用、旧
      const referenced = "b".repeat(64);
      env.repo.insert({ id: referenced, ...base, createdAt: "2026-01-01T00:00:00.000Z" });
      env.repo.markReferenced([referenced], "2026-01-02T00:00:00.000Z");
      const fresh = "c".repeat(64);
      env.repo.insert({ id: fresh, ...base, createdAt: "2026-01-10T00:00:00.000Z" }); // 未引用、新

      const removed = env.repo.deleteExpired("2026-01-05T00:00:00.000Z");
      assert.deepEqual(removed, [id]);
      assert.equal(env.repo.find(id), null);
      assert.ok(env.repo.find(referenced));
      assert.ok(env.repo.find(fresh));
    } finally {
      env.close();
    }
  });

  it("未知 id 返回 null", () => {
    const env = makeRepo();
    try {
      assert.equal(env.repo.find("b".repeat(64)), null);
    } finally {
      env.close();
    }
  });
});
