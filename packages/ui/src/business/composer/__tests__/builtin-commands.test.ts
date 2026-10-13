/** 内置命令判定单测：只有无参命令能按「整条输入就是命令名」就地执行 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUILTIN_COMMANDS, builtinCommandIdOf } from "../builtin-commands";

describe("builtinCommandIdOf", () => {
  it("整条输入就是一个无参命令名时取其 id", () => {
    assert.equal(builtinCommandIdOf("/new"), "new");
    assert.equal(builtinCommandIdOf("  /stop  "), "stop");
  });

  it("参数型命令不认，交给正文解析", () => {
    assert.equal(builtinCommandIdOf("/goal"), null);
    assert.equal(builtinCommandIdOf("/goal "), null);
    assert.equal(builtinCommandIdOf("/goal 写一份发布说明"), null);
  });

  it("未知命令、带参数的无参命令与普通文本都不认", () => {
    assert.equal(builtinCommandIdOf("/next"), null);
    assert.equal(builtinCommandIdOf("/new 额外的话"), null);
    assert.equal(builtinCommandIdOf("看看 /new"), null);
    assert.equal(builtinCommandIdOf(""), null);
  });
});

describe("BUILTIN_COMMANDS", () => {
  it("要求正文参数的命令都给了参数提示，菜单与 /help 才能显示用法", () => {
    const withArgument = BUILTIN_COMMANDS.filter((command) => command.takesArgument === true);
    assert.ok(withArgument.length > 0);
    for (const command of withArgument) {
      assert.equal(typeof command.argumentHint, "string");
    }
  });
});
