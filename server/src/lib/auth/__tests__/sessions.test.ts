/** lib/auth/sessions：会话签发、token 校验、过期与撤销 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { AUTH_SESSION_TTL_MS } from "../../../constants";
import { openDatabase } from "../../../db";
import { AuthSessionRepository } from "../../../db/auth-session-repository";
import { hashSessionToken, SessionService } from "../sessions";

const created: string[] = [];

const makeService = () => {
  const root = mkdtempSync(join(tmpdir(), "auth-sessions-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return { service: new SessionService(new AuthSessionRepository(db)), close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SessionService", () => {
  it("签发后可用明文 token 校验，库内只存哈希", () => {
    const env = makeService();
    try {
      const at = new Date("2026-01-01T00:00:00.000Z");
      const { token, record } = env.service.create("浏览器", at);

      assert.equal(record.expiresAt, new Date(at.getTime() + AUTH_SESSION_TTL_MS).toISOString());
      assert.notEqual(record.tokenHash, token);
      assert.equal(record.tokenHash, hashSessionToken(token));

      const authed = env.service.authenticate(token, new Date("2026-01-02T00:00:00.000Z"));
      assert.equal(authed?.id, record.id);
      assert.equal(authed?.lastSeenAt, "2026-01-02T00:00:00.000Z");
    } finally {
      env.close();
    }
  });

  it("未知 token 与已撤销会话都校验失败", () => {
    const env = makeService();
    try {
      const { token, record } = env.service.create("浏览器");
      assert.equal(env.service.authenticate("不存在的 token"), null);

      env.service.revoke(record.id);
      assert.equal(env.service.authenticate(token), null);
    } finally {
      env.close();
    }
  });

  it("过期会话校验失败", () => {
    const env = makeService();
    try {
      const at = new Date("2026-01-01T00:00:00.000Z");
      const { token } = env.service.create("浏览器", at);
      const later = new Date(at.getTime() + AUTH_SESSION_TTL_MS + 1000);
      assert.equal(env.service.authenticate(token, later), null);
    } finally {
      env.close();
    }
  });

  it("revokeAll 撤销全部会话，list 只出有效会话", () => {
    const env = makeService();
    try {
      env.service.create("a");
      env.service.create("b");
      assert.equal(env.service.list().length, 2);
      assert.equal(env.service.revokeAll(), 2);
      assert.equal(env.service.list().length, 0);
    } finally {
      env.close();
    }
  });
});
