import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isReadOnlyCommand } from "../capability/read-only-command.ts";
import {
  createToolGateExtension,
  isMutatingTool,
  planModeToolNames,
} from "../capability/tool-gate.ts";

/**
 * 工具闸门的单元测试（spec §2.5 / §4.6）。
 *
 * 这里不搭真实会话：闸门本身是纯的 `tool_call` 处理器，用一个假的 `pi` 抓住处理器直接调用，
 * 比端到端更快、断言更准。三条都是"看着像能跑、其实没生效"的高危逻辑：
 * - 决策记忆（选了"总是允许"却还会再弹）；
 * - plan 档的工具集收窄（改动类工具必须根本不在列表里）；
 * - plan 档的只读命令白名单（否则计划模式连 `git status` 都做不了）。
 */

type GateHandler = (
  event: ToolCallEvent,
  ctx: unknown,
) => Promise<{ block?: boolean; reason?: string }>;

function captureGate(options: Parameters<typeof createToolGateExtension>[0]): GateHandler {
  let handler: GateHandler | undefined;
  const pi = {
    on: (event: string, listener: GateHandler) => {
      if (event === "tool_call") handler = listener;
    },
  } as unknown as ExtensionAPI;
  createToolGateExtension(options)(pi);
  if (handler === undefined) throw new Error("闸门没有注册 tool_call 处理器");
  return handler;
}

/** 带 UI 的上下文：批准弹窗会真的被调用（记录被问了几次）。 */
function uiContext(answers: string[]): { ctx: unknown; asked: () => number } {
  let count = 0;
  const ctx = {
    hasUI: true,
    ui: {
      select: async (): Promise<string> => {
        const answer = answers[count] ?? "拒绝";
        count += 1;
        return answer;
      },
    },
  };
  return { ctx, asked: () => count };
}

function toolCall(toolName: string, input: Record<string, unknown> = {}): ToolCallEvent {
  return { type: "tool_call", toolName, toolCallId: "call-1", input } as unknown as ToolCallEvent;
}

describe("工具闸门", () => {
  it("决策记忆：选过「本会话内总是允许」之后不再重复弹窗", async () => {
    const sessionAllowed = new Set<string>();
    const handler = captureGate({ autonomy: () => "confirm", sessionAllowed });
    const { ctx, asked } = uiContext(["本会话内总是允许"]);

    const first = await handler(toolCall("write", { path: "a.txt" }), ctx);
    expect(first.block).toBeUndefined();
    expect(asked()).toBe(1);
    expect(sessionAllowed.has("write")).toBe(true);

    // 第二次必须直接放行、不再问——这正是此前失效的那条路径
    const second = await handler(toolCall("write", { path: "b.txt" }), ctx);
    expect(second.block).toBeUndefined();
    expect(asked(), "第二次不应再弹窗").toBe(1);
  });

  it("决策记忆只覆盖被允许的那一个工具", async () => {
    const sessionAllowed = new Set<string>(["write"]);
    const handler = captureGate({ autonomy: () => "confirm", sessionAllowed });
    const { ctx, asked } = uiContext(["拒绝"]);
    const blocked = await handler(toolCall("bash", { command: "rm -rf /" }), ctx);
    expect(blocked.block).toBe(true);
    expect(asked()).toBe(1);
  });

  it("plan 档：只读命令放行、写命令与改动类工具拦下", async () => {
    const handler = captureGate({ autonomy: () => "plan", sessionAllowed: new Set<string>() });
    const { ctx } = uiContext([]);

    await expect(handler(toolCall("bash", { command: "git status" }), ctx)).resolves.toEqual({});
    await expect(handler(toolCall("read", { path: "a.txt" }), ctx)).resolves.toEqual({});
    await expect(
      handler(toolCall("bash", { command: "rm -rf build" }), ctx),
    ).resolves.toMatchObject({
      block: true,
    });
    await expect(
      handler(toolCall("bash", { command: "echo x > a.txt" }), ctx),
    ).resolves.toMatchObject({ block: true });
    await expect(handler(toolCall("write", { path: "a.txt" }), ctx)).resolves.toMatchObject({
      block: true,
    });
  });

  it("confirm 档在没有可承载交互的控制层时拒绝（无人应答不放行）", async () => {
    const handler = captureGate({ autonomy: () => "confirm", sessionAllowed: new Set<string>() });
    const result = await handler(toolCall("write", { path: "a.txt" }), { hasUI: false });
    expect(result.block).toBe(true);
  });
});

describe("isMutatingTool", () => {
  it("question 是纯人类交互，不算改动类（对它要批准会连着打断两次）", () => {
    expect(isMutatingTool("question")).toBe(false);
    // 其余仍按原判断：写文件、跑命令、第三方工具都要批准
    expect(isMutatingTool("write")).toBe(true);
    expect(isMutatingTool("bash")).toBe(true);
    expect(isMutatingTool("mcp__echo__echo")).toBe(true);
    expect(isMutatingTool("read")).toBe(false);
  });

  it("plan 档保留 question（计划模式里问人是只读行为）", () => {
    expect(planModeToolNames(["read", "write", "question", "bash"])).toEqual([
      "read",
      "question",
      "bash",
    ]);
  });
});

describe("planModeToolNames", () => {
  it("摘掉改动类工具，但留下只读工具与命令类工具", () => {
    const kept = planModeToolNames(["read", "grep", "write", "edit", "bash", "subagent"]);
    expect(kept).toEqual(["read", "grep", "bash", "subagent"]);
  });
});

describe("isReadOnlyCommand", () => {
  it("认得出常见的只读命令", () => {
    for (const command of [
      "ls -la",
      "git status",
      "git log --oneline -5",
      "rg TODO",
      "cat a.txt",
    ]) {
      expect(isReadOnlyCommand(command), command).toBe(true);
    }
  });

  it("写命令、重定向与危险操作一律不算只读", () => {
    for (const command of [
      "rm -rf build",
      "git commit -m x",
      "echo hi > a.txt",
      "cat a.txt >> b.txt",
      "sudo ls",
      "npm install",
      "",
    ]) {
      expect(isReadOnlyCommand(command), command).toBe(false);
    }
  });
});

describe("isMutatingTool", () => {
  it("未知工具按改动类处理（宁可多问一句）", () => {
    expect(isMutatingTool("some_third_party_tool")).toBe(true);
  });

  it("作用域自带限制的自研工具不算改动类", () => {
    for (const name of ["memory", "subagent", "goal", "wiki"]) {
      expect(isMutatingTool(name), name).toBe(false);
    }
  });
});
