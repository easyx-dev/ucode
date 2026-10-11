/** 服务连接解析的单测：注册文件内容 → 连接信息 */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { appHomeDirname } from "@ucode/brand/values";

import { envFileName, resolveHomeDir, toServiceConnection } from "../connection.ts";

test("toServiceConnection：回环地址原样使用", () => {
  assert.deepEqual(toServiceConnection({ host: "127.0.0.1", port: 2048, serviceToken: "t" }), {
    baseUrl: "http://127.0.0.1:2048",
    token: "t",
  });
});

test("toServiceConnection：通配地址改用回环连接", () => {
  assert.equal(
    toServiceConnection({ host: "0.0.0.0", port: 2048, serviceToken: "t" })?.baseUrl,
    "http://127.0.0.1:2048",
  );
  assert.equal(
    toServiceConnection({ host: "::", port: 2048, serviceToken: "t" })?.baseUrl,
    "http://127.0.0.1:2048",
  );
});

test("toServiceConnection：缺字段或类型不符返回 null", () => {
  assert.equal(toServiceConnection(null), null);
  assert.equal(toServiceConnection({}), null);
  assert.equal(toServiceConnection({ host: "127.0.0.1", port: 0, serviceToken: "t" }), null);
  assert.equal(toServiceConnection({ host: "127.0.0.1", port: 2048, serviceToken: "" }), null);
});

test("resolveHomeDir：绝对路径原样，相对路径落到仓库根下", () => {
  assert.equal(resolveHomeDir("/tmp/home"), "/tmp/home");
  assert.match(resolveHomeDir("relative-home"), /\/relative-home$/);
});

test("resolveHomeDir：`~` 展开为用户主目录（.env.prod 写的就是这种形式）", () => {
  const withTilde = `~/${appHomeDirname}`;
  assert.equal(resolveHomeDir(withTilde), resolve(homedir(), appHomeDirname));
  assert.equal(resolveHomeDir("~ "), homedir());
  // 不展开的话会拼成 `<仓库根>/~/…`，表现为「未找到服务注册文件」而连不上服务
  assert.ok(!resolveHomeDir(withTilde).includes("/~/"), "不应把 `~` 当普通目录名");
});

test("envFileName：生产读 .env.prod，其余读 .env", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(envFileName(), ".env.prod");
    process.env.NODE_ENV = "development";
    assert.equal(envFileName(), ".env");
    delete process.env.NODE_ENV;
    assert.equal(envFileName(), ".env");
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
