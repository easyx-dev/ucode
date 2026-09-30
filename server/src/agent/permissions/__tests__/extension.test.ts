/**
 * 权限拦截（内联扩展）单测：把 `decidePermission` 的判定接到 `tool_call` 上之后的行为——
 * 阻断 / 放行 / 审批三条路径，以及「本会话恒允」按范围追加 allow 规则的短路。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import type { PermissionRule } from "../engine";
import { createPermissionExtension, type PermissionGate } from "../extension";

type Handler = (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>;

/** 用最小的假 ExtensionAPI 捕获注册的 `tool_call` 处理器 */
const mount = (gate: PermissionGate): Handler => {
  let handler: Handler | undefined;
  const pi = {
    on: (_event: string, next: Handler) => {
      handler = next;
    },
  } as unknown as ExtensionAPI;
  createPermissionExtension(gate)(pi);
  assert.ok(handler, "应注册 tool_call 处理器");
  return handler;
};

const callEvent = (toolName: string, input: Record<string, unknown>): ToolCallEvent =>
  ({ type: "tool_call", toolCallId: "tc1", toolName, input }) as unknown as ToolCallEvent;

const baseGate = (rules: PermissionRule[]): PermissionGate => ({
  cwd: "/work",
  rules: () => rules,
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
    assert.equal(await handler(callEvent("read", { path: "notes.md" })), undefined);
  });

  it("deny 直接阻断并带出规则说明", async () => {
    const handler = mount(
      baseGate([{ tool: "edit", pattern: "*", action: "deny", note: "只读模式" }]),
    );
    const result = await handler(callEvent("edit", { path: "src/a.ts" }));
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
    assert.equal(await handler(callEvent("read", { path: "notes.md" })), undefined);
    assert.deepEqual(seen, [{ tool: "read", subject: "/work/notes.md", scope: "*.md" }]);
  });

  it("ask 被拒绝时阻断", async () => {
    const handler = mount(baseGate([ASK_RULE]));
    const result = await handler(callEvent("read", { path: "notes.md" }));
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
    assert.equal(await handler(callEvent("read", { path: "notes.md" })), undefined);
    assert.equal(requested, false);
  });

  it("allow_session 按判定范围追加一条 allow 规则", async () => {
    const granted: PermissionRule[] = [];
    const handler = mount({
      ...baseGate([ASK_RULE]),
      request: async () => "allow_session",
      grant: (rule) => granted.push(rule),
    });
    assert.equal(await handler(callEvent("read", { path: "notes.md" })), undefined);
    assert.deepEqual(granted, [
      { tool: "read", pattern: "*.md", action: "allow", note: "文档文件" },
    ]);
  });
});
