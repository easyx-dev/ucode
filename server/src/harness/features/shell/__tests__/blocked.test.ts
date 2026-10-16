/**
 * 命令预检单测：命中 / 放行两类，并确认命中后底层执行根本没被调用。
 *
 * 假 `BashOperations` 记录调用，`exitCode` 之外的字段不参与判定——那是 pi 侧累积输出的口径。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BashOperations } from "@earendil-works/pi-coding-agent";

import { blockedCommandNotice, withBlockedCommands } from "../blocked";

describe("shell 命令预检", () => {
  it("拦下写死的 sleep，并给出替代写法", () => {
    const notice = blockedCommandNotice("sleep 20; curl -s localhost:19688/api/v1/health");
    assert.ok(notice);
    assert.match(notice, /sleep 20/);
    assert.match(notice, /browser_snapshot/);
  });

  it("承接在连接符 / 管道 / 子 shell 后的 sleep 同样拦下，且认单位", () => {
    assert.ok(blockedCommandNotice("make && sleep 10"));
    assert.ok(blockedCommandNotice("curl x | tee y; sleep 2m"));
    assert.ok(blockedCommandNotice("(sleep 90)"));
    assert.ok(blockedCommandNotice("sleep 1m"));
  });

  it("短空等、字面量与普通命令放行", () => {
    assert.equal(blockedCommandNotice("sleep 0.2"), null);
    assert.equal(blockedCommandNotice('echo "sleep 5"'), null);
    assert.equal(blockedCommandNotice("rg 'sleep 3' server/src"), null);
    assert.equal(blockedCommandNotice("pnpm check"), null);
  });

  it("引号里的分隔符与 sleep 都不算命令", () => {
    assert.equal(blockedCommandNotice("rg 'a; sleep 3' server/src"), null);
    assert.equal(blockedCommandNotice('echo "x; sleep 5"'), null);
    assert.equal(blockedCommandNotice('git commit -m "fix: 起服务; sleep 2"'), null);
    // 已知代价：引号里的真等待也放过，换来「引号内不算命令」这条能一句话说清的规则
    assert.equal(blockedCommandNotice("bash -c 'sleep 5'"), null);

    // 引号外的 sleep 照旧命中，且引号不影响同一行里后续命令的判定
    assert.ok(blockedCommandNotice('sleep 30 && rg "x; sleep 1" server/src'));
  });

  it("说明里原样引用命令，缺省单位不补成 s", () => {
    const notice = blockedCommandNotice("sleep 20; pnpm check");
    assert.ok(notice);
    assert.match(notice, /`sleep 20` 未执行/);
  });

  it("命中后不调底层执行，说明走 onData 并把退出码置为非零", async () => {
    let called = false;
    const base: BashOperations = {
      exec: async () => {
        called = true;
        return { exitCode: 0 };
      },
    };
    const chunks: string[] = [];

    const result = await withBlockedCommands(base).exec("sleep 5", "/tmp", {
      onData: (data) => chunks.push(data.toString()),
    });

    assert.equal(called, false, "命中后不应再调用底层执行");
    assert.equal(result.exitCode, 1);
    assert.match(chunks.join(""), /sleep 5/);
  });

  it("没命中的命令原样交给底层", async () => {
    const base: BashOperations = {
      exec: async (command) => ({ exitCode: command === "pnpm check" ? 0 : 1 }),
    };

    const result = await withBlockedCommands(base).exec("pnpm check", "/tmp", {
      onData: () => {},
    });

    assert.equal(result.exitCode, 0);
  });
});
