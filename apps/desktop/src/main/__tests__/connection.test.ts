/** 服务连接解析的单测：注册文件内容 → 连接信息 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveHomeDir, toServiceConnection } from "../connection.ts";

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
