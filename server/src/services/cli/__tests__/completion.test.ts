/** services/cli/completion：三个 shell 的补全脚本都覆盖完整的命令面 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brand } from "@ucode/brand/values";

import { COMPLETION_SHELLS, isCompletionShell, renderCompletion } from "..";
import { CLI_COMMANDS } from "../spec";

const shellOf = (shell: string): string => {
  const script = renderCompletion(shell);
  assert.ok(script, `${shell} 应有补全脚本`);
  return script;
};

describe("renderCompletion", () => {
  it("未知 shell 回传 undefined", () => {
    assert.equal(renderCompletion("pwsh"), undefined);
  });

  it("三种 shell 都认", () => {
    for (const shell of COMPLETION_SHELLS) assert.equal(isCompletionShell(shell), true);
    assert.equal(isCompletionShell("pwsh"), false);
  });

  it("每个 shell 都列全命令", () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = shellOf(shell);
      for (const command of CLI_COMMANDS) {
        assert.ok(script.includes(command.name), `${shell} 缺少命令 ${command.name}`);
      }
    }
  });

  it("每个 shell 都带选项：bash / zsh 写 `--lines`，fish 写 `-l lines`", () => {
    for (const shell of ["bash", "zsh"] as const) {
      const script = shellOf(shell);
      assert.ok(script.includes("--lines"), `${shell} 缺少 --lines`);
      assert.ok(script.includes("--follow"), `${shell} 缺少 --follow`);
    }
    const fish = shellOf("fish");
    assert.ok(fish.includes("-l lines"));
    assert.ok(fish.includes("-l follow"));
  });

  it("bash 补齐命令与选项", () => {
    const script = shellOf("bash");
    assert.ok(script.includes(`complete -F _${brand.slug} ${brand.slug}`));
    assert.ok(script.includes('opts="-n --lines -f --follow -h --help"'));
    assert.ok(script.includes("bash zsh fish"), "completion 的位置参数要能补");
  });

  it("zsh 用 compdef 注册并带中文说明", () => {
    const script = shellOf("zsh");
    assert.ok(script.includes(`compdef _${brand.slug} ${brand.slug}`));
    assert.ok(script.includes(`_describe -t commands '${brand.slug} 命令'`));
    assert.ok(script.includes("start:"));
  });

  it("fish 用子命令条件限制选项作用域", () => {
    const script = shellOf("fish");
    assert.ok(script.includes(`complete -c ${brand.slug} -f`));
    assert.ok(script.includes("__fish_seen_subcommand_from"));
    assert.ok(script.includes("-s n -l lines -r"));
  });
});
