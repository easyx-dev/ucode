/** 非交互环境注入单测：覆盖语义、不污染入参，以及与 pi 真实 shell 后端组合的落地效果 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

import { createNonInteractiveSpawnHook, withNonInteractiveEnv, withPluginPath } from "../env";

describe("withNonInteractiveEnv", () => {
  it("覆盖同名变量（用户 shell 的 EDITOR / PAGER 正是挂起来源），保留其余变量", () => {
    const env = withNonInteractiveEnv({ EDITOR: "vim", GIT_PAGER: "less", PATH: "/bin" });

    assert.equal(env.EDITOR, "true");
    assert.equal(env.VISUAL, "true");
    assert.equal(env.GIT_PAGER, "cat");
    assert.equal(env.PAGER, "cat");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.PATH, "/bin");
  });

  it("不修改传入的环境对象", () => {
    const input: NodeJS.ProcessEnv = { EDITOR: "vim" };

    withNonInteractiveEnv(input);

    assert.equal(input.EDITOR, "vim");
    assert.equal(input.PAGER, undefined);
  });

  it("spawn 钩子只换环境，不动命令与工作目录", () => {
    const context = createNonInteractiveSpawnHook()({
      command: "git rebase --continue",
      cwd: "/tmp/project",
      env: { GIT_EDITOR: "vim" },
    });

    assert.equal(context.command, "git rebase --continue");
    assert.equal(context.cwd, "/tmp/project");
    assert.equal(context.env.GIT_EDITOR, "true");
  });

  // 端到端那一步：注入的环境要真的落到 pi 的 shell 后端上——本次故障就是 git 在无 tty 下
  // 拉起 vim 等输入，所以直接问 git「你会用哪个编辑器」
  it("注入的环境真的传给子进程（git 取到的编辑器是 true）", async (t) => {
    if (spawnSync("git", ["--version"]).status !== 0) {
      t.skip("环境里没有 git");
      return;
    }
    const context = createNonInteractiveSpawnHook()({
      command: 'printf \'%s|%s\' "$(git var GIT_EDITOR)" "$(git var GIT_PAGER)"',
      cwd: tmpdir(),
      env: { ...process.env, GIT_EDITOR: "vim", GIT_PAGER: "less" },
    });
    const chunks: string[] = [];

    const result = await createLocalBashOperations().exec(context.command, context.cwd, {
      onData: (data) => chunks.push(data.toString()),
      env: context.env,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(chunks.join(""), "true|cat");
  });
});

describe("withPluginPath", () => {
  it("把插件 bin 目录追加到 PATH 末尾，不遮蔽系统命令", () => {
    const merged = withPluginPath({ PATH: "/usr/bin:/bin" }, ["/plugins/a/bin", "/plugins/b/bin"]);
    assert.equal(merged.PATH?.split(":").slice(0, 2).join(":"), "/usr/bin:/bin");
    assert.ok(merged.PATH?.endsWith("/plugins/a/bin:/plugins/b/bin"));
  });

  it("没有目录时原样返回；PATH 缺失时只放插件目录", () => {
    const env = { PATH: "/usr/bin" };
    assert.equal(withPluginPath(env, []), env);
    assert.equal(withPluginPath({}, ["/plugins/a/bin"]).PATH, "/plugins/a/bin");
  });

  it("spawn 钩子把插件目录与非交互环境一起合上", () => {
    const context = createNonInteractiveSpawnHook(["/plugins/a/bin"])({
      command: "echo hi",
      cwd: "/tmp",
      env: { PATH: "/usr/bin" },
      signal: new AbortController().signal,
    } as never);

    assert.equal(context.env.EDITOR, "true");
    assert.ok(context.env.PATH?.startsWith("/usr/bin"));
    assert.ok(context.env.PATH?.endsWith("/plugins/a/bin"));
  });
});
