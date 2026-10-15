/** lib/auth/middleware：放行清单与单一凭证管线（serviceToken / 会话 token） */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { API_BASE_PATH } from "@ucode/contracts";
import { Hono } from "hono";
import { openDatabase } from "../../../db";
import { AuthSessionRepository } from "../../../db/auth-session-repository";
import type { ServiceRegistration } from "../../../platform/service-registration";
import { CredentialStore } from "../credentials";
import { type AuthVariables, createAuthMiddleware } from "../middleware";
import { SessionService } from "../sessions";

const created: string[] = [];

/** 票据预检：默认一律不认，个别用例再覆盖 */
const makeApp = (peekTicket: (ticket: string, terminalId: string) => boolean = () => false) => {
  const root = mkdtempSync(join(tmpdir(), "auth-middleware-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  const registration: ServiceRegistration = {
    host: "127.0.0.1",
    port: 19688,
    pid: null,
    instanceId: null,
    serviceToken: "service-token-value",
    password: "登录密码",
    createdAt: "2026-01-01T00:00:00.000Z",
    relay: { enabled: false, url: null, deviceId: null, deviceToken: null },
  };
  const credentials = new CredentialStore(registration, join(root, "service.json"));
  const sessions = new SessionService(new AuthSessionRepository(db));

  const app = new Hono<AuthVariables>();
  app.use(`${API_BASE_PATH}/*`, createAuthMiddleware({ credentials, sessions, peekTicket }));
  app.get(`${API_BASE_PATH}/health`, (c) => c.json({ up: true }));
  app.post(`${API_BASE_PATH}/auth/pairing/redeem`, (c) => c.json({ redeemed: true }));
  app.get(`${API_BASE_PATH}/probe`, (c) => c.json({ sessionId: c.get("principal").sessionId }));
  app.get(`${API_BASE_PATH}/terminal/stream`, (c) => c.json({ upgraded: true }));

  return { app, sessions, close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("createAuthMiddleware", () => {
  it("终端握手：票有效且绑对上才放行", async () => {
    const env = makeApp((ticket, terminalId) => ticket === "good" && terminalId === "term-1");
    try {
      const ok = await env.app.request(
        `${API_BASE_PATH}/terminal/stream?terminalId=term-1&ticket=good`,
      );
      assert.equal(ok.status, 200);

      // 没票 / 票不对 / 绑的不是这个终端：都在建连之前就拒掉
      for (const query of [
        "",
        "?terminalId=term-1",
        "?terminalId=term-1&ticket=bad",
        "?terminalId=term-2&ticket=good",
      ]) {
        const denied = await env.app.request(`${API_BASE_PATH}/terminal/stream${query}`);
        assert.equal(denied.status, 401, `query「${query}」应被拒`);
      }
    } finally {
      env.close();
    }
  });

  it("放行清单内的接口不需要凭证", async () => {
    const env = makeApp();
    try {
      assert.equal((await env.app.request(`${API_BASE_PATH}/health`)).status, 200);
      assert.equal(
        (
          await env.app.request(`${API_BASE_PATH}/auth/pairing/redeem`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
        200,
      );
    } finally {
      env.close();
    }
  });

  it("无凭证返回 401 unauthorized；伪造 token 同样被拒", async () => {
    const env = makeApp();
    try {
      const anonymous = await env.app.request(`${API_BASE_PATH}/probe`);
      assert.equal(anonymous.status, 401);
      const failure = (await anonymous.json()) as { code: string };
      assert.equal(failure.code, "unauthorized");

      assert.equal(
        (await env.app.request(`${API_BASE_PATH}/probe`, { headers: bearer("faked") })).status,
        401,
      );
    } finally {
      env.close();
    }
  });

  it("serviceToken 通过且不带会话 id", async () => {
    const env = makeApp();
    try {
      const response = await env.app.request(`${API_BASE_PATH}/probe`, {
        headers: bearer("service-token-value"),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { sessionId: null });
    } finally {
      env.close();
    }
  });

  it("会话 token 通过并带出会话 id；撤销后失效", async () => {
    const env = makeApp();
    try {
      const { token, record } = env.sessions.create("浏览器");

      const response = await env.app.request(`${API_BASE_PATH}/probe`, {
        headers: bearer(token),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { sessionId: record.id });

      env.sessions.revoke(record.id);
      assert.equal(
        (await env.app.request(`${API_BASE_PATH}/probe`, { headers: bearer(token) })).status,
        401,
      );
    } finally {
      env.close();
    }
  });
});
