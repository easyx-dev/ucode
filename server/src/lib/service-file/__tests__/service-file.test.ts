/** lib/service-file：注册文件的生成、复用、权限与损坏回落 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createPassword,
  ensureServiceRegistration,
  readServiceRegistration,
  writeServiceRegistration,
} from "../index";

const created: string[] = [];

const makePath = (): string => {
  const root = mkdtempSync(join(tmpdir(), "service-file-"));
  created.push(root);
  return join(root, "app", "service.json");
};

const modeOf = (path: string): number => statSync(path).mode & 0o777;

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("service-file", () => {
  it("首次 ensure 生成凭证并落盘 0600", () => {
    const path = makePath();
    const { registration, created: isCreated } = ensureServiceRegistration({
      path,
      host: "127.0.0.1",
      port: 2048,
    });

    assert.equal(isCreated, true);
    assert.equal(registration.host, "127.0.0.1");
    assert.equal(registration.port, 2048);
    assert.ok(registration.serviceToken.length >= 20);
    assert.match(registration.password, /^(?:[a-z2-9]{4}-){4}[a-z2-9]{4}$/);
    assert.equal(modeOf(path), 0o600);
    assert.deepEqual(readServiceRegistration(path), registration);
  });

  it("再次 ensure 复用凭证，仅对齐 host / port", () => {
    const path = makePath();
    const first = ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });
    const second = ensureServiceRegistration({ path, host: "0.0.0.0", port: 3000 });

    assert.equal(second.created, false);
    assert.equal(second.registration.serviceToken, first.registration.serviceToken);
    assert.equal(second.registration.password, first.registration.password);
    assert.equal(second.registration.host, "0.0.0.0");
    assert.equal(second.registration.port, 3000);
  });

  it("端口回写后可被下次读取复用", () => {
    const path = makePath();
    const { registration } = ensureServiceRegistration({ path, host: "127.0.0.1", port: 0 });
    writeServiceRegistration(path, { ...registration, port: 51234 });

    assert.equal(readServiceRegistration(path)?.port, 51234);
  });

  it("损坏文件视为缺失并重新生成", () => {
    const path = makePath();
    ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });
    writeFileSync(path, "{ 不是合法 JSON", "utf8");

    assert.equal(readServiceRegistration(path), null);
    const { created: isCreated } = ensureServiceRegistration({
      path,
      host: "127.0.0.1",
      port: 2048,
    });
    assert.equal(isCreated, true);
    assert.ok(readServiceRegistration(path));
  });

  it("密码落在可读字符集内且两次生成不同", () => {
    const a = createPassword();
    const b = createPassword();
    assert.notEqual(a, b);
    assert.match(a, /^[a-z2-9-]+$/);
  });
});
