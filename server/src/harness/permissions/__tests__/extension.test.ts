/**
 * 权限拦截（内联扩展）单测：把 `decidePermission` 的判定接到 `tool_call` 上之后的行为——
 * 阻断 / 放行 / 审批三条路径，审批带上本轮中断信号，以及「本会话恒允」按范围追加 allow 规则的短路。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

import type { PermissionRule } from "../engine";
import { createPermissionExtension, type PermissionGate } from "../extension";

type Handler = (
  event: ToolCallEvent,
  ctx: ExtensionContext,
) => Promise<ToolCallEventResult | undefined>;

/** 用最小的假 ExtensionAPI 捕获注册的 `tool_call` 处理器；tools 供 MCP annotations 兜底查询 */
const mount = (gate: PermissionGate, tools: ToolInfo[] = []): Handler => {
  let handler: Handler | undefined;
  const pi = {
    on: (_event: string, next: Handler) => {
      handler = next;
    },
    getAllTools: () => tools,
  } as unknown as ExtensionAPI;
  createPermissionExtension(gate)(pi);
  assert.ok(handler, "应注册 tool_call 处理器");
  return handler;
};

const callEvent = (toolName: string, input: Record<string, unknown>): ToolCallEvent =>
  ({ type: "tool_call", toolCallId: "tc1", toolName, input }) as unknown as ToolCallEvent;

/** 权限扩展只读 `ctx.signal`，其余字段与本文件无关 */
const call = (
  handler: Handler,
  event: ToolCallEvent,
  signal?: AbortSignal,
): Promise<ToolCallEventResult | undefined> =>
  handler(event, { signal } as unknown as ExtensionContext);

const baseGate = (rules: PermissionRule[]): PermissionGate => ({
  cwd: "/work",
  rules: () => rules,
  approvalMode: "default",
  grant: () => {},
  request: async () => "deny",
});

const ASK_RULE: PermissionRule = {
  tool: "read",
  pattern: "*.md",
  action: "ask",
  note: "文档文件",
};

describe("createPermissionExtension", () => {
  it("没有命中规则时放行", async () => {
    const handler = mount(baseGate([]));
    assert.equal(await call(handler, callEvent("read", { path: "notes.md" })), undefined);
  });

  it("deny 直接阻断并带出规则说明", async () => {
    const handler = mount(
      baseGate([{ tool: "edit", pattern: "*", action: "deny", note: "只读模式" }]),
    );
    const result = await call(handler, callEvent("edit", { path: "src/a.ts" }));
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /只读模式/);
  });

  it("ask 经用户放行后继续，并把授权范围交给审批", async () => {
    const seen: Array<{ tool: string; subject: string; scope: string }> = [];
    const handler = mount({
      ...baseGate([ASK_RULE]),
      request: async (ask) => {
        seen.push({ tool: ask.tool, subject: ask.subject, scope: ask.scope });
        return "allow_once";
      },
    });
    assert.equal(await call(handler, callEvent("read", { path: "notes.md" })), undefined);
    assert.deepEqual(seen, [{ tool: "read", subject: "/work/notes.md", scope: "*.md" }]);
  });

  it("审批拿到本轮的中断信号，不丢在中间层", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const handler = mount({
      ...baseGate([ASK_RULE]),
      request: async (ask) => {
        seen = ask.signal;
        return "allow_once";
      },
    });
    await call(handler, callEvent("read", { path: "notes.md" }), controller.signal);
    assert.equal(seen, controller.signal);
  });

  it("ask 被拒绝时阻断", async () => {
    const handler = mount(baseGate([ASK_RULE]));
    const result = await call(handler, callEvent("read", { path: "notes.md" }));
    assert.equal(result?.block, true);
  });

  it("规则表里已有同范围的授权时不再发起审批", async () => {
    let requested = false;
    const handler = mount({
      ...baseGate([ASK_RULE, { tool: "read", pattern: "*.md", action: "allow" }]),
      request: async () => {
        requested = true;
        return "deny";
      },
    });
    assert.equal(await call(handler, callEvent("read", { path: "notes.md" })), undefined);
    assert.equal(requested, false);
  });

  it("allow_session 按判定范围追加一条 allow 规则", async () => {
    const granted: PermissionRule[] = [];
    const handler = mount({
      ...baseGate([ASK_RULE]),
      request: async () => "allow_session",
      grant: (rule) => granted.push(rule),
    });
    assert.equal(await call(handler, callEvent("read", { path: "notes.md" })), undefined);
    assert.deepEqual(granted, [
      { tool: "read", pattern: "*.md", action: "allow", note: "文档文件" },
    ]);
  });

  it("auto 档自动放行工具级 ask，不再发起审批", async () => {
    let requested = false;
    const handler = mount({
      ...baseGate([ASK_RULE]),
      approvalMode: "auto",
      request: async () => {
        requested = true;
        return "deny";
      },
    });
    assert.equal(await call(handler, callEvent("read", { path: "notes.md" })), undefined);
    assert.equal(requested, false);
  });

  it("full 档把越界审批也放行，但 deny 仍阻断", async () => {
    let requested = false;
    const handler = mount({
      ...baseGate([]),
      approvalMode: "full",
      request: async () => {
        requested = true;
        return "deny";
      },
    });
    assert.equal(await call(handler, callEvent("read", { path: "/etc/passwd" })), undefined);
    assert.equal(requested, false);

    const denied = mount({
      ...baseGate([{ tool: "edit", pattern: "*", action: "deny", note: "只读模式" }]),
      approvalMode: "full",
    });
    const result = await call(denied, callEvent("edit", { path: "src/a.ts" }));
    assert.equal(result?.block, true);
  });
});

const mcpTool = (name: string, annotations: ToolInfo["annotations"]): ToolInfo =>
  ({
    name,
    description: "",
    parameters: {},
    exposure: "codemode",
    sourceInfo: {},
    annotations,
  }) as unknown as ToolInfo;

describe("MCP annotations 兜底", () => {
  it("只读 MCP 工具无需审批直接放行", async () => {
    let requested = false;
    const handler = mount(
      {
        ...baseGate([]),
        request: async () => {
          requested = true;
          return "deny";
        },
      },
      [mcpTool("mcp__fs__read_file", { readOnlyHint: true })],
    );
    assert.equal(await call(handler, callEvent("mcp__fs__read_file", { path: "a" })), undefined);
    assert.equal(requested, false);
  });

  it("未声明只读的 MCP 工具发起审批，展示参数摘要与原因", async () => {
    const seen: Array<{ tool: string; subject: string; scope: string }> = [];
    const handler = mount(
      {
        ...baseGate([]),
        request: async (ask) => {
          seen.push({ tool: ask.tool, subject: ask.subject, scope: ask.scope });
          return "allow_once";
        },
      },
      [mcpTool("mcp__fs__write_file", { destructiveHint: true })],
    );
    assert.equal(
      await call(handler, callEvent("mcp__fs__write_file", { path: "/tmp/a" })),
      undefined,
    );
    assert.equal(seen[0]?.tool, "mcp__fs__write_file");
    assert.match(seen[0]?.subject ?? "", /删除或覆盖/);
    assert.equal(seen[0]?.scope, "*");
  });

  it("显式规则覆盖 annotations：只读工具也能被 deny", async () => {
    const handler = mount(
      baseGate([{ tool: "mcp__fs__read_file", pattern: "*", action: "deny", note: "禁用该工具" }]),
      [mcpTool("mcp__fs__read_file", { readOnlyHint: true })],
    );
    const result = await call(handler, callEvent("mcp__fs__read_file", { path: "a" }));
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /禁用该工具/);
  });

  it("本会话恒允按工具名追加 allow，后续调用不再审批", async () => {
    const granted: PermissionRule[] = [];
    const handler = mount(
      {
        ...baseGate([]),
        request: async () => "allow_session",
        grant: (rule) => granted.push(rule),
      },
      [mcpTool("mcp__fs__create_dir", undefined)],
    );
    assert.equal(await call(handler, callEvent("mcp__fs__create_dir", { path: "a" })), undefined);
    assert.deepEqual(granted, [
      { tool: "mcp__fs__create_dir", pattern: "*", action: "allow", note: undefined },
    ]);
  });
});
