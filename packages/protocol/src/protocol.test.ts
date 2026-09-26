import { describe, expect, it } from "vitest";
import {
  COMMAND_CAPABILITIES,
  COMMAND_NAMES,
  type CommandName,
  errorResponse,
  isVersionSupported,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseCommand,
  parseErrorResponse,
  parseServerMessage,
  parseWireText,
  SessionEntrySchema,
} from "./index.ts";

describe("版本校验", () => {
  it("本实现支持自己的版本，拒绝更高版本（从不静默降级）", () => {
    expect(isVersionSupported(PROTOCOL_VERSION)).toBe(true);
    expect(isVersionSupported(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isVersionSupported(0)).toBe(false);
  });
});

describe("命令解析：两段式，失败必须可识别", () => {
  it("合法命令：拿到 id / command / sessionId / 参数", () => {
    const parsed = parseCommand({
      type: "command",
      id: "c1",
      command: "prompt",
      sessionId: "s1",
      args: { text: "hi" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.command).toBe("prompt");
      expect(parsed.sessionId).toBe("s1");
      expect(parsed.args).toEqual({ text: "hi" });
    }
  });

  it("信封破损：没有 id（调用方必须能处理）", () => {
    const parsed = parseCommand({ type: "command", command: "prompt" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.stage).toBe("envelope");
      expect(parsed.id).toBeNull();
    }
  });

  it("未知命令：仍带 id，错误可诊断", () => {
    const parsed = parseCommand({ type: "command", id: "c2", command: "does.not.exist" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.stage).toBe("unknown_command");
      expect(parsed.id).toBe("c2");
    }
  });

  it("参数不合法：仍带 id，且指出命令名", () => {
    const parsed = parseCommand({ type: "command", id: "c3", command: "prompt", args: {} });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.stage).toBe("args");
      expect(parsed.id).toBe("c3");
      expect(parsed.command).toBe("prompt");
    }
  });

  it("每个命令都映射到一个能力（信任矩阵不靠命令名硬编码）", () => {
    for (const name of COMMAND_NAMES) {
      expect(COMMAND_CAPABILITIES[name as CommandName], name).toBeTruthy();
    }
  });
});

describe("响应形状", () => {
  it("解析失败：无 id，command 为 parse", () => {
    const response = parseErrorResponse("坏了");
    expect(response.id).toBeNull();
    expect(response.command).toBe("parse");
    expect(response.success).toBe(false);
    expect(response.error?.code).toBe("parse_error");
  });

  it("失败响应带可诊断错误标识", () => {
    const response = errorResponse("c9", "bash", "unsupported_capability");
    expect(response.success).toBe(false);
    expect(response.error?.code).toBe("unsupported_capability");
    expect(parseServerMessage(response).ok).toBe(true);
  });
});

describe("线路解析", () => {
  it("不是 JSON：invalid_json", () => {
    const result = parseWireText("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_json");
  });

  it("是 JSON 但不是协议消息：invalid_message，且报出 type", () => {
    const parsed = parseWireText(JSON.stringify({ type: "nope" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const message = parseClientMessage(parsed.value);
      expect(message.ok).toBe(false);
      if (!message.ok) {
        expect(message.error.code).toBe("invalid_message");
        expect(message.error.message).toContain("nope");
      }
    }
  });

  it("hello 往返：默认值被补齐", () => {
    const message = parseClientMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "tui-1",
      clientKind: "tui",
      binding: "stdio",
    });
    expect(message.ok).toBe(true);
    if (message.ok && message.value.type === "hello") {
      expect(message.value.capabilities).toEqual([]);
      expect(message.value.auth).toBeNull();
      expect(message.value.resume).toBeNull();
      expect(message.value.identity).toEqual({ user: null, device: null });
    }
  });

  it("事件：message_delta 与 entry_appended 的权威性区分在类型上成立", () => {
    const delta = parseServerMessage({
      type: "message_delta",
      sessionId: "s1",
      kind: "text",
      delta: "你",
      index: 0,
    });
    expect(delta.ok).toBe(true);

    const appended = parseServerMessage({
      type: "entry_appended",
      sessionId: "s1",
      seq: 3,
      entry: { type: "message", id: "e1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" },
    });
    expect(appended.ok).toBe(true);
  });

  it("交互面：ui.request 是服务端消息，ui.response 是客户端消息", () => {
    const request = parseServerMessage({
      type: "ui.request",
      id: "ui-1",
      sessionId: "s1",
      method: "confirm",
      params: { title: "允许？", message: "要执行 rm 吗" },
    });
    expect(request.ok).toBe(true);

    const response = parseClientMessage({ type: "ui.response", id: "ui-1", value: true });
    expect(response.ok).toBe(true);
    if (response.ok && response.value.type === "ui.response") {
      expect(response.value.cancelled).toBe(false);
      expect(response.value.responderId).toBeNull();
    }

    // 方向搞错必须被拒
    expect(
      parseClientMessage({ type: "ui.request", id: "x", method: "confirm", params: {} }).ok,
    ).toBe(false);
  });
});

describe("会话记录：宽松对象，附加字段不得被剥掉", () => {
  it("保留 pi 写入的额外字段", () => {
    const entry = SessionEntrySchema.parse({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      extra: 1,
    });
    expect((entry as Record<string, unknown>).message).toBeDefined();
    expect((entry as Record<string, unknown>).extra).toBe(1);
  });

  it("缺少公共字段则拒绝", () => {
    expect(SessionEntrySchema.safeParse({ type: "message" }).success).toBe(false);
  });
});
