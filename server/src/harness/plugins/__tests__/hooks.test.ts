/** harness/plugins/hooks：hooks 配置的解析、matcher 与执行语义 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadPluginHooks, matchesToolName, type PluginHookBinding } from "../hooks";
import { createPluginHooksExtension, hookEnv, runPluginHook } from "../hooks-runner";
import { PLUGIN_VARIABLE_PREFIX } from "../variables";

const created: string[] = [];

const makeScript = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-hook-"));
  created.push(dir);
  const file = join(dir, "hook.sh");
  writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(file, 0o755);
  return file;
};

const binding = (command: string, over: Partial<PluginHookBinding> = {}): PluginHookBinding => ({
  pluginId: "demo@local",
  pluginRoot: "/tmp/demo",
  pluginDataDir: "/tmp/demo-data",
  config: {},
  event: "PreToolUse",
  command,
  timeoutMs: 5_000,
  isAsync: false,
  ...over,
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadPluginHooks", () => {
  it("按事件解析出绑定：matcher、timeout、async 与默认值", () => {
    const load = loadPluginHooks({
      pluginId: "demo@local",
      pluginRoot: "/tmp/demo",
      pluginDataDir: "/tmp/demo-data",
      config: {},
      source: "hooks/hooks.json",
      value: {
        hooks: {
          PreToolUse: [
            { matcher: "^bash$", hooks: [{ type: "command", command: "check.sh", timeout: 5 }] },
          ],
          SessionStart: [{ hooks: [{ command: "start.sh", async: true }] }],
        },
      },
    });

    assert.deepEqual(load.bindings, [
      {
        pluginId: "demo@local",
        pluginRoot: "/tmp/demo",
        pluginDataDir: "/tmp/demo-data",
        config: {},
        event: "PreToolUse",
        matcher: "^bash$",
        command: "check.sh",
        timeoutMs: 5_000,
        isAsync: false,
      },
      {
        pluginId: "demo@local",
        pluginRoot: "/tmp/demo",
        pluginDataDir: "/tmp/demo-data",
        config: {},
        event: "SessionStart",
        command: "start.sh",
        timeoutMs: 60_000,
        isAsync: true,
      },
    ]);
    assert.deepEqual(load.diagnostics, []);
  });

  it("不认识的事件、类型、坏正则只出诊断，其余照常解析", () => {
    const load = loadPluginHooks({
      pluginId: "d",
      pluginRoot: "/tmp/d",
      pluginDataDir: "/tmp/d-data",
      config: {},
      source: "hooks",
      value: {
        PermissionRequest: [{ hooks: [{ command: "a.sh" }] }],
        PreToolUse: [
          { matcher: "([", hooks: [{ command: "b.sh" }] },
          { hooks: [{ type: "http", command: "c.sh" }, { command: "  " }, { command: "ok.sh" }] },
        ],
        Stop: [{ hooks: [{ command: "stop.sh", async: true }] }],
      },
    });

    assert.deepEqual(
      load.bindings.map((item) => item.command),
      ["ok.sh", "stop.sh"],
    );
    const messages = load.diagnostics.map((item) => item.message).join("\n");
    assert.match(messages, /事件 PermissionRequest 本轮不实现/);
    assert.match(messages, /matcher 不是合法正则/);
    assert.match(messages, /handler 类型 http 本轮不实现/);
    assert.match(messages, /handler 缺少 command/);
  });

  it("命令行里的插件变量按上下文解析：user_config 在 shell 字段上被拒", () => {
    const load = loadPluginHooks({
      pluginId: "demo@local",
      pluginRoot: "/plugins/demo",
      pluginDataDir: "/plugins/data/demo-local",
      config: { retries: 3, token: "secret" },
      projectDir: "/work",
      source: "hooks/hooks.json",
      value: {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  command:
                    "run --root ${" +
                    PLUGIN_VARIABLE_PREFIX +
                    "_PLUGIN_ROOT} --data $" +
                    "{" +
                    PLUGIN_VARIABLE_PREFIX +
                    "_PLUGIN_DATA} --cwd $" +
                    "{" +
                    PLUGIN_VARIABLE_PREFIX +
                    "_PROJECT_DIR} --token ${user_config.token} --n ${user_config.retries}",
                },
              ],
            },
          ],
          SessionStart: [{ hooks: [{ command: "echo ${CLAUDE_PLUGIN_ROOT}" }] }],
        },
      },
    });

    assert.equal(
      load.bindings[0]?.command,
      "run --root /plugins/demo --data /plugins/data/demo-local --cwd /work --token  --n ",
    );
    assert.equal(load.bindings[1]?.command, "echo /plugins/demo", "兼容别名同样解析");
    const messages = load.diagnostics.map((item) => item.message).join("\n");
    assert.match(messages, /shell 字段里不能引用 user_config/);
    assert.equal(load.bindings[0]?.config.retries, 3, "配置透传给子进程环境");
    assert.equal(load.bindings[0]?.pluginDataDir, "/plugins/data/demo-local");
  });

  it("决策类事件上的 async 被降级为同步并告警", () => {
    const load = loadPluginHooks({
      pluginId: "d",
      pluginRoot: "/tmp/d",
      pluginDataDir: "/tmp/d-data",
      config: {},
      source: "hooks",
      value: { hooks: { PreToolUse: [{ hooks: [{ command: "a.sh", async: true }] }] } },
    });

    assert.equal(load.bindings[0]?.isAsync, false);
    assert.match(load.diagnostics[0]?.message ?? "", /async 不生效/);
  });

  it("形状不对时只报一条错误，不抛异常", () => {
    const load = loadPluginHooks({
      pluginId: "d",
      pluginRoot: "/tmp/d",
      pluginDataDir: "/tmp/d-data",
      config: {},
      source: "hooks",
      value: ["nope"],
    });
    assert.deepEqual(load.bindings, []);
    assert.equal(load.diagnostics[0]?.level, "error");
  });
});

describe("matchesToolName", () => {
  it("没有 matcher 即全匹配；有 matcher 按正则", () => {
    assert.equal(matchesToolName(binding("a.sh"), "bash"), true);
    assert.equal(matchesToolName(binding("a.sh", { matcher: "^bash$" }), "bash"), true);
    assert.equal(matchesToolName(binding("a.sh", { matcher: "^bash$" }), "read"), false);
  });
});

describe("runPluginHook", () => {
  const payload = {
    hook_event_name: "PreToolUse" as const,
    cwd: "/tmp/project",
    session_id: "s1",
    tool_name: "bash",
    tool_input: { command: "rm -rf /" },
  };

  it("exit 2 视为阻断，stderr 作原因", async () => {
    const outcome = await runPluginHook(
      binding(makeScript('echo "危险命令" >&2\nexit 2')),
      payload,
    );
    assert.equal(outcome.blocked, true);
    assert.equal(outcome.reason, "危险命令");
  });

  it("stdout 的 block 决策与 additionalContext 都生效，stdin 收到 Claude 形状的载荷", async () => {
    const script = makeScript(
      'read -r line\ncase "$line" in *\\"tool_name\\":\\"bash\\"*) ;; *) exit 3;; esac\n' +
        'echo \'{"decision":"block","reason":"策略不允许","hookSpecificOutput":{"additionalContext":"记得加 --dry-run"}}\'',
    );
    const outcome = await runPluginHook(binding(script), payload);
    assert.equal(outcome.blocked, true);
    assert.equal(outcome.reason, "策略不允许");
    assert.equal(outcome.additionalContext, "记得加 --dry-run");
  });

  it("非零退出但与阻断无关时不阻断（只记摘要）", async () => {
    const outcome = await runPluginHook(binding(makeScript("exit 1")), payload);
    assert.equal(outcome.blocked, false);
    assert.match(outcome.summary, /非零退出（1）/);
  });

  it("超时不阻断", async () => {
    const outcome = await runPluginHook(
      binding(makeScript("read -r line\nwhile true; do :; done"), { timeoutMs: 300 }),
      payload,
    );
    assert.equal(outcome.blocked, false);
    assert.match(outcome.summary, /超时/);
  });

  it("环境变量带品牌前缀与 Claude / ZCode 别名", () => {
    const env = hookEnv(binding("a.sh"), "/tmp/project", { PATH: "/usr/bin" });
    assert.equal(env.CLAUDE_PLUGIN_ROOT, "/tmp/demo");
    assert.equal(env.ZCODE_PROJECT_DIR, "/tmp/project");
    assert.equal(env.PATH, "/usr/bin");
    const brandKey = Object.keys(env).find(
      (key) =>
        key.endsWith("_PLUGIN_ROOT") && key !== "CLAUDE_PLUGIN_ROOT" && key !== "ZCODE_PLUGIN_ROOT",
    );
    assert.ok(brandKey, "品牌前缀的 PLUGIN_ROOT 必须存在");
  });
});

describe("createPluginHooksExtension", () => {
  const collectHandlers = (bindings: PluginHookBinding[], cwd = "/tmp/project") => {
    const handlers = new Map<string, (event: never) => unknown>();
    const pi = {
      on: (event: string, handler: (payload: never) => unknown) => {
        handlers.set(event, handler);
        return () => undefined;
      },
    };
    createPluginHooksExtension({ bindings, cwd, sessionId: "s1" })(pi as never);
    return handlers;
  };

  it("PreToolUse 阻断时返回 block，未命中 matcher 时放行", async () => {
    const handlers = collectHandlers([
      binding(makeScript('echo \'{"decision":"block","reason":"不许"}\''), { matcher: "^bash$" }),
    ]);
    const toolCall = handlers.get("tool_call");
    assert.ok(toolCall);

    assert.deepEqual(await toolCall({ toolName: "bash", input: {} } as never), {
      block: true,
      reason: "不许",
    });
    assert.equal(await toolCall({ toolName: "read", input: {} } as never), undefined);
  });

  it("UserPromptSubmit 的 additionalContext 走 before_agent_start 的 message", async () => {
    const handlers = collectHandlers([
      binding(
        makeScript(
          'read -r line\necho \'{"hookSpecificOutput":{"additionalContext":"当前分支是 feature"}}\'',
        ),
        { event: "UserPromptSubmit" },
      ),
    ]);
    const beforeStart = handlers.get("before_agent_start");
    assert.ok(beforeStart);

    const result = (await beforeStart({ prompt: "继续" } as never)) as {
      message?: { customType: string; content: string; display: boolean };
    };
    assert.equal(result.message?.customType, "plugin_hook_context");
    assert.equal(result.message?.content, "当前分支是 feature");
    assert.equal(result.message?.display, false);
  });

  it("没有绑定的插件不注册任何 handler", () => {
    assert.equal(collectHandlers([]).size, 0);
  });
});

describe("hookEnv", () => {
  it("给子进程注入插件目录、数据目录与 userConfig 选项，并保留品牌别名", () => {
    const env = hookEnv(
      {
        pluginId: "demo@local",
        pluginRoot: "/plugins/demo",
        pluginDataDir: "/plugins/data/demo-local",
        config: { apiKey: "k", maxRetries: 2 },
        event: "PreToolUse",
        command: "x",
        timeoutMs: 1000,
        isAsync: false,
      },
      "/work",
      { PATH: "/usr/bin" },
    );

    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.CLAUDE_PLUGIN_DATA, "/plugins/data/demo-local");
    assert.equal(env.CLAUDE_PROJECT_DIR, "/work");
    assert.equal(env[`${PLUGIN_VARIABLE_PREFIX}_PLUGIN_OPTION_APIKEY`], "k");
    assert.equal(env[`${PLUGIN_VARIABLE_PREFIX}_PLUGIN_OPTION_MAXRETRIES`], "2");
    assert.equal(env.CLAUDE_PLUGIN_OPTION_APIKEY, "k");
  });
});
