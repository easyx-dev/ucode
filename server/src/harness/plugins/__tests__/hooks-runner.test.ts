/**
 * 命令式 hook 的挂载单测：只关心「哪个插件事件挂到 pi 的哪个事件上」与阻断语义，
 * 不真的起子进程（`runPluginHook` 走的是 `run` 注入之外的真实命令，这里只用不匹配的绑定规避）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginHookBinding } from "../hooks";
import { createPluginHooksExtension } from "../hooks-runner";

type Registered = { event: string; handler: (event: never) => unknown };

/** 假 pi：只收集注册的事件名与处理器 */
const fakePi = () => {
  const registered: Registered[] = [];
  const pi = {
    on(event: string, handler: (event: never) => unknown) {
      registered.push({ event, handler });
      return () => {};
    },
  };
  return { pi: pi as never, registered };
};

const binding = (event: PluginHookBinding["event"], command: string): PluginHookBinding => ({
  pluginId: "demo@local",
  pluginRoot: "/tmp/demo",
  pluginDataDir: "/tmp/demo-data",
  config: {},
  event,
  command,
  timeoutMs: 1000,
  isAsync: true,
});

describe("createPluginHooksExtension", () => {
  it("Stop 只挂 agent_settled：agent_end 是底层循环（含重试）结束发的，都挂会跑多遍", () => {
    const { pi, registered } = fakePi();
    createPluginHooksExtension({
      bindings: [binding("Stop", "stop.sh")],
      cwd: "/work",
      sessionId: "s1",
    })(pi);

    assert.deepEqual(
      registered.map((item) => item.event),
      ["agent_settled"],
    );
  });

  it("按事件挂到对应 pi 事件上：SessionStart / UserPromptSubmit / PreToolUse / PostToolUse", () => {
    const { pi, registered } = fakePi();
    createPluginHooksExtension({
      bindings: [
        binding("SessionStart", "start.sh"),
        binding("UserPromptSubmit", "prompt.sh"),
        binding("PreToolUse", "pre.sh"),
        binding("PostToolUse", "post.sh"),
        binding("PostToolUseFailure", "post-fail.sh"),
      ],
      cwd: "/work",
      sessionId: "s1",
    })(pi);

    assert.deepEqual(
      registered.map((item) => item.event),
      ["tool_call", "tool_result", "before_agent_start", "session_start"],
    );
  });

  it("没有绑定时不注册任何处理器", () => {
    const { pi, registered } = fakePi();
    createPluginHooksExtension({ bindings: [], cwd: "/work", sessionId: "s1" })(pi);
    assert.deepEqual(registered, []);
  });
});
