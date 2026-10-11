/** db/auth-session-repository：登录会话的增删查、撤销与过期清理 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openDatabase } from "..";
import { type AuthSessionRecord, AuthSessionRepository } from "../auth-session-repository";

const created: string[] = [];

const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "auth-repo-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return { repo: new AuthSessionRepository(db), close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const record = (id: string, overrides: Partial<AuthSessionRecord> = {}): AuthSessionRecord => ({
  id,
  tokenHash: `hash-${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
  label: "浏览器",
  ...overrides,
});

describe("AuthSessionRepository", () => {
  it("写入后可读回，并能按 token 哈希查找", () => {
    const env = makeRepo();
    try {
      env.repo.create(record("a"));
      assert.deepEqual(env.repo.get("a"), record("a"));
      assert.equal(env.repo.findByTokenHash("hash-a")?.id, "a");
      assert.equal(env.repo.findByTokenHash("nope"), null);
    } finally {
      env.close();
    }
  });

  it("listActive 过滤已撤销与已过期", () => {
    const env = makeRepo();
    try {
      env.repo.create(record("live"));
      env.repo.create(record("revoked", { revokedAt: "2026-01-02T00:00:00.000Z" }));
      env.repo.create(record("expired", { expiresAt: "2025-12-31T00:00:00.000Z" }));

      const ids = env.repo.listActive("2026-01-15T00:00:00.000Z").map((item) => item.id);
      assert.deepEqual(ids, ["live"]);
    } finally {
      env.close();
    }
  });

  it("revoke 幂等，revokeAll 返回撤销数", () => {
    const env = makeRepo();
    try {
      env.repo.create(record("a"));
      env.repo.create(record("b"));
      assert.equal(env.repo.revoke("a", "2026-01-05T00:00:00.000Z"), true);
      assert.equal(env.repo.revoke("a", "2026-01-06T00:00:00.000Z"), false);
      assert.equal(env.repo.revokeAll("2026-01-07T00:00:00.000Z"), 1);
    } finally {
      env.close();
    }
  });

  it("touch 刷新 lastSeenAt", () => {
    const env = makeRepo();
    try {
      env.repo.create(record("a"));
      env.repo.touch("a", "2026-01-09T00:00:00.000Z");
      assert.equal(env.repo.get("a")?.lastSeenAt, "2026-01-09T00:00:00.000Z");
    } finally {
      env.close();
    }
  });

  it("deleteExpired 只删过期行", () => {
    const env = makeRepo();
    try {
      env.repo.create(record("old", { expiresAt: "2026-01-01T00:00:00.000Z" }));
      env.repo.create(record("fresh", { expiresAt: "2027-01-01T00:00:00.000Z" }));
      assert.equal(env.repo.deleteExpired("2026-06-01T00:00:00.000Z"), 1);
      assert.equal(env.repo.get("old"), null);
      assert.ok(env.repo.get("fresh"));
    } finally {
      env.close();
    }
  });
});
