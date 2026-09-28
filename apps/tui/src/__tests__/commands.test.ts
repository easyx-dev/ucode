import type { AgentSdk } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import { type CommandEffects, runCommand } from "../commands.ts";

type Recorded = { kind: string; detail?: unknown };

function harness(state: { activeSessionId?: string | null; models?: unknown[] } = {}): {
  sdk: AgentSdk;
  effects: CommandEffects;
  calls: Recorded[];
  notices: { level: string; message: string }[];
} {
  const calls: Recorded[] = [];
  const notices: { level: string; message: string }[] = [];
  const sdk = {
    state: {
      activeSessionId: state.activeSessionId ?? null,
      models: state.models ?? [],
    },
    createSession: async (options: unknown) => {
      calls.push({ kind: "createSession", detail: options });
      return { sessionId: "s-new" };
    },
    setModel: async (sessionId: string, provider: string, modelId: string) => {
      calls.push({ kind: "setModel", detail: `${sessionId}:${provider}/${modelId}` });
    },
    setAutonomy: async (sessionId: string, level: string) => {
      calls.push({ kind: "setAutonomy", detail: `${sessionId}:${level}` });
    },
    addProvider: async (input: unknown) => {
      calls.push({ kind: "addProvider", detail: input });
      return { created: true, warning: null };
    },
  } as unknown as AgentSdk;

  const effects: CommandEffects = {
    notify: (level, message) => notices.push({ level, message }),
    succeed: (message) => notices.push({ level: "info", message }),
    showSessionPicker: () => calls.push({ kind: "showSessionPicker" }),
    exit: () => calls.push({ kind: "exit" }),
  };
  return { sdk, effects, calls, notices };
}

describe("runCommand", () => {
  it("/help 打印命令清单（与补全同一份来源）", async () => {
    const { sdk, effects, notices } = harness();
    expect(await runCommand(sdk, effects, "/help", [])).toBe(true);
    expect(notices[0]?.message).toContain("/provider");
  });

  it("/new 带上目录建会话", async () => {
    const { sdk, effects, calls } = harness();
    await runCommand(sdk, effects, "/new", ["/tmp/x"]);
    expect(calls[0]).toEqual({ kind: "createSession", detail: { cwd: "/tmp/x" } });
  });

  it("/new 不带参数时用默认目录（空对象，而不是 undefined）", async () => {
    const { sdk, effects, calls } = harness();
    await runCommand(sdk, effects, "/new", []);
    expect(calls[0]?.detail).toEqual({});
  });

  it("/model 没有活动会话时明确报错，不去猜一个会话", async () => {
    const { sdk, effects, calls, notices } = harness();
    await runCommand(sdk, effects, "/model", ["demo/x"]);
    expect(calls).toEqual([]);
    expect(notices[0]).toMatchObject({ level: "warn" });
  });

  it("/model 带供应商/模型切换", async () => {
    const { sdk, effects, calls } = harness({ activeSessionId: "s1" });
    await runCommand(sdk, effects, "/model", ["demo/deepseek-v4-flash"]);
    expect(calls[0]).toEqual({ kind: "setModel", detail: "s1:demo/deepseek-v4-flash" });
  });

  it("/model 参数写错时给用法，不静默", async () => {
    const { sdk, effects, calls, notices } = harness({ activeSessionId: "s1" });
    await runCommand(sdk, effects, "/model", ["没有斜杠"]);
    expect(calls).toEqual([]);
    expect(notices[0]?.message).toContain("用法");
  });

  it("/model 不带参数时列出可用模型；一个都没有时给配置指引", async () => {
    const empty = harness({ activeSessionId: "s1", models: [] });
    await runCommand(empty.sdk, empty.effects, "/model", []);
    expect(empty.notices[0]).toMatchObject({ level: "warn" });

    const some = harness({
      activeSessionId: "s1",
      models: [{ provider: "demo", modelId: "x", name: "x" }],
    });
    await runCommand(some.sdk, some.effects, "/model", []);
    expect(some.notices[0]?.message).toContain("demo/x");
  });

  it("/provider 参数不全时给可照抄的例子", async () => {
    const { sdk, effects, calls, notices } = harness();
    await runCommand(sdk, effects, "/provider", ["only-id"]);
    expect(calls).toEqual([]);
    expect(notices[0]?.message).toContain("/provider my-proxy");
  });

  it("/provider 成功时说明是新增还是覆盖", async () => {
    const { sdk, effects, calls, notices } = harness();
    await runCommand(sdk, effects, "/provider", ["demo", "http://127.0.0.1:8000/v1", "m"]);
    expect(calls[0]?.kind).toBe("addProvider");
    expect(notices[0]?.message).toContain("添加");
  });

  it("/autonomy 切换自主级别", async () => {
    const { sdk, effects, calls } = harness({ activeSessionId: "s1" });
    await runCommand(sdk, effects, "/autonomy", ["plan"]);
    expect(calls[0]).toEqual({ kind: "setAutonomy", detail: "s1:plan" });
  });

  it("/sessions 交给选择列表，自己不做 UI", async () => {
    const { sdk, effects, calls } = harness();
    await runCommand(sdk, effects, "/sessions", []);
    expect(calls[0]?.kind).toBe("showSessionPicker");
  });

  it("/quit 退出", async () => {
    const { sdk, effects, calls } = harness();
    await runCommand(sdk, effects, "/quit", []);
    expect(calls[0]?.kind).toBe("exit");
  });

  it("不认识的命令返回 false（由调用方提示，别在这里吞掉）", async () => {
    const { sdk, effects, notices } = harness();
    expect(await runCommand(sdk, effects, "/nope", [])).toBe(false);
    expect(notices).toEqual([]);
  });
});
