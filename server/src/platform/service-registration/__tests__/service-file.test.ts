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
  toUrlHost,
  writeServicePid,
  writeServiceRegistration,
} from "..";

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
  it("首次 ensure 生成凭证并落盘 0600（pid 先置空）", () => {
    const path = makePath();
    const { registration, created: isCreated } = ensureServiceRegistration({
      path,
      host: "127.0.0.1",
      port: 2048,
    });

    assert.equal(isCreated, true);
    assert.equal(registration.host, "127.0.0.1");
    assert.equal(registration.port, 2048);
    assert.equal(registration.pid, null);
    assert.ok(registration.serviceToken.length >= 20);
    assert.match(registration.password, /^(?:[a-z2-9]{4}-){4}[a-z2-9]{4}$/);
    // Windows 上权限落在 ACL 而不是 mode 上（见 platform/file-permissions）
    if (process.platform !== "win32") assert.equal(modeOf(path), 0o600);
    assert.deepEqual(readServiceRegistration(path), registration);
  });

  it("再次 ensure 复用凭证，仅对齐 host / port，不改 pid", () => {
    const path = makePath();
    const first = ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });
    writeServicePid(path, 111);
    const second = ensureServiceRegistration({ path, host: "0.0.0.0", port: 3000 });

    assert.equal(second.created, false);
    assert.equal(second.registration.serviceToken, first.registration.serviceToken);
    assert.equal(second.registration.password, first.registration.password);
    assert.equal(second.registration.host, "0.0.0.0");
    assert.equal(second.registration.port, 3000);
    assert.equal(second.registration.pid, 111);
    assert.equal(readServiceRegistration(path)?.pid, 111);
  });

  it("注册文件带本次启动的实例标识，缺这一项的老文件照样能读", () => {
    const path = makePath();
    const { registration } = ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });
    assert.ok(registration.instanceId);
    assert.equal(readServiceRegistration(path)?.instanceId, registration.instanceId);

    // 老注册文件没有 instanceId：不能判成损坏（那会连凭证一起重新生成、把已配对的客户端踢掉）
    const legacy: Record<string, unknown> = { ...registration };
    delete legacy.instanceId;
    writeFileSync(path, JSON.stringify(legacy), "utf8");
    assert.equal(readServiceRegistration(path)?.instanceId, null);
    assert.equal(readServiceRegistration(path)?.serviceToken, registration.serviceToken);
  });

  it("再次 ensure 不动注册文件里的实例标识：改 host / 端口重起不该把在跑实例的身份换掉", () => {
    const path = makePath();
    const { registration } = ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });
    // 模拟「另一个进程还在跑」：文件里记的是它的身份
    writeServiceRegistration(path, {
      ...registration,
      instanceId: "other-instance",
      host: "127.0.0.1",
      port: 2048,
    });

    const again = ensureServiceRegistration({ path, host: "0.0.0.0", port: 2048 });

    assert.equal(again.registration.instanceId, "other-instance");
    assert.equal(readServiceRegistration(path)?.instanceId, "other-instance");
  });

  it("端口回写后可被下次读取复用", () => {
    const path = makePath();
    const { registration } = ensureServiceRegistration({ path, host: "127.0.0.1", port: 0 });
    writeServiceRegistration(path, { ...registration, port: 51234 });

    assert.equal(readServiceRegistration(path)?.port, 51234);
  });

  it("writeServicePid 写入 / 清空 pid，其余字段不变", () => {
    const path = makePath();
    const { registration } = ensureServiceRegistration({ path, host: "127.0.0.1", port: 2048 });

    writeServicePid(path, 4321);
    const written = readServiceRegistration(path);
    assert.equal(written?.pid, 4321);
    assert.equal(written?.serviceToken, registration.serviceToken);

    writeServicePid(path, null);
    const cleared = readServiceRegistration(path);
    assert.equal(cleared?.pid, null);
    assert.equal(cleared?.serviceToken, registration.serviceToken);
    assert.equal(cleared?.port, 2048);
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

describe("toUrlHost", () => {
  it("通配地址改用回环，IPv6 字面量加方括号", () => {
    assert.equal(toUrlHost("127.0.0.1"), "127.0.0.1");
    assert.equal(toUrlHost("192.168.1.2"), "192.168.1.2");
    assert.equal(toUrlHost("0.0.0.0"), "127.0.0.1");
    assert.equal(toUrlHost("::"), "127.0.0.1");
    // 不加方括号拼出的 `http://::1:19688` 不是合法 URL，`fetch` 会直接抛错
    assert.equal(toUrlHost("::1"), "[::1]");
    assert.equal(toUrlHost("2001:db8::1"), "[2001:db8::1]");
  });
});
