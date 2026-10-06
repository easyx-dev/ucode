/** lib/auth/credentials：密码原地更新与外置注册对象保持一致、凭证校验 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { readServiceRegistration, type ServiceRegistration } from "../../service-file";
import { CredentialStore } from "../credentials";

const created: string[] = [];

const makePath = (): string => {
  const root = mkdtempSync(join(tmpdir(), "credentials-"));
  created.push(root);
  return join(root, "app", "service.json");
};

const makeRegistration = (): ServiceRegistration => ({
  host: "127.0.0.1",
  port: 2048,
  pid: 1234,
  serviceToken: "token-abc",
  password: "old-password",
  createdAt: "2026-01-01T00:00:00.000Z",
  relay: { enabled: false, url: null, deviceId: null, deviceToken: null },
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CredentialStore", () => {
  it("setPassword 原地更新，外部持有的注册对象同步看到新密码", () => {
    const path = makePath();
    const registration = makeRegistration();
    const store = new CredentialStore(registration, path);

    store.setPassword("new-password");

    // /service/host 会整体落盘外部的 registration，若这里换成新对象，那次写入会把旧密码带回来
    assert.equal(registration.password, "new-password");
    assert.equal(readServiceRegistration(path)?.password, "new-password");
  });

  it("按常量时间比较凭证，长度不同直接判否", () => {
    const store = new CredentialStore(makeRegistration(), makePath());
    assert.equal(store.verifyPassword("old-password"), true);
    assert.equal(store.verifyPassword("old-passwor"), false);
    assert.equal(store.verifyToken("token-abc"), true);
    assert.equal(store.verifyToken("token-xyz"), false);
  });
});
