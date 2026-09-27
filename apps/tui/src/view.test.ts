import type { DisplayItem, SessionSummary, SessionView } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  bannerFor,
  COMMAND_SPECS,
  commandSuggestions,
  formatItem,
  helpText,
  hintLine,
  sessionItems,
  statusLine,
  transcriptLines,
} from "./view.ts";

function emptyView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    summary: null,
    state: null,
    entries: [],
    seqByEntryId: {},
    maxSeq: 0,
    streaming: { text: "", thinking: "" },
    running: false,
    pendingInteractions: 0,
    usage: null,
    lastError: null,
    needsResync: false,
    readOnly: false,
    ...over,
  };
}

describe("展示项格式化", () => {
  it("用户与助手消息带角色前缀", () => {
    const user: DisplayItem = { kind: "user", id: "1", seq: 1, text: "你好", timestamp: "" };
    const assistant: DisplayItem = {
      kind: "assistant",
      id: "2",
      seq: 2,
      markdown: "**在**",
      timestamp: "",
    };
    expect(formatItem(user)).toBe("你 > 你好");
    expect(formatItem(assistant)).toBe("助手 > **在**");
  });

  it("工具卡片带状态标记与参数摘要，有输出时缩进附在下面", () => {
    const running: DisplayItem = {
      kind: "tool",
      id: "3",
      seq: 3,
      callId: "c1",
      toolName: "read",
      args: { path: "/tmp/a.ts" },
      status: "running",
      output: "",
      timestamp: "",
    };
    expect(formatItem(running)).toContain("[工具 ...] read");
    expect(formatItem(running)).toContain("path=/tmp/a.ts");

    const done: DisplayItem = { ...running, status: "done", output: "第一行\n第二行" };
    const text = formatItem(done);
    expect(text).toContain("[工具 v] read");
    expect(text).toContain("    第一行");
    expect(text).toContain("    第二行");

    const error: DisplayItem = { ...running, status: "error", output: "boom" };
    expect(formatItem(error)).toContain("[工具 x] read");
  });

  it("思考、通知、压缩、待决交互各有前缀", () => {
    expect(formatItem({ kind: "thinking", id: "t", seq: 1, text: "嗯", timestamp: "" })).toBe(
      "(思考) 嗯",
    );
    expect(formatItem({ kind: "notice", id: "n", seq: 1, text: "提示", timestamp: "" })).toBe(
      "· 提示",
    );
    expect(
      formatItem({ kind: "compaction", id: "c", seq: 1, summary: "摘要", timestamp: "" }),
    ).toBe("(上下文已压缩) 摘要");
    expect(
      formatItem({
        kind: "pending",
        id: "p",
        seq: 1,
        interactionId: "i",
        method: "confirm",
        params: { title: "允许？" },
        timestamp: "",
      }),
    ).toContain("[待决交互] confirm");
  });
});

describe("会话文本渲染", () => {
  it("空会话给出引导语", () => {
    expect(transcriptLines(emptyView(), { width: 80 }).join("\n")).toContain("还没有对话");
  });

  it("渲染未落盘的流式内容", () => {
    const lines = transcriptLines(
      emptyView({ streaming: { text: "正在生成", thinking: "想想" } }),
      { width: 80 },
    ).join("\n");
    expect(lines).toContain("助手 > 正在生成");
    expect(lines).toContain("(思考) 想想");
  });

  it("错误被显式展示（不吞）", () => {
    const lines = transcriptLines(
      emptyView({
        lastError: { code: "internal_error", message: "爆了", details: undefined } as never,
      }),
      { width: 80 },
    ).join("\n");
    expect(lines).toContain("[错误] 爆了");
  });

  it("助手消息含 thinking + text 两段时，正文照样渲染（真实模型形状）", () => {
    const entry = {
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "想一想" },
          { type: "text", text: "ZEBRA-5301" },
        ],
      },
    } as unknown as SessionView["entries"][number];
    const rendered = transcriptLines(
      emptyView({ entries: [entry], seqByEntryId: { a1: 1 }, maxSeq: 1 }),
      { width: 80 },
    ).join("\n");
    expect(rendered).toContain("助手 > ZEBRA-5301");
  });

  it("超长时按宽度换行（交给 pi-tui 的 Text）", () => {
    const long = "字".repeat(200);
    const lines = transcriptLines(emptyView({ streaming: { text: long, thinking: "" } }), {
      width: 40,
    });
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(41);
  });
});

describe("状态栏", () => {
  it("拼接产品名、连接、目录、模型、状态与会话数", () => {
    const line = statusLine({
      productName: "测试产品",
      connected: true,
      trustLevel: "local",
      sessionCount: 2,
      view: emptyView({
        state: {
          sessionId: "s1",
          name: null,
          cwd: "/work",
          model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
          thinkingLevel: null,
          autonomy: "confirm",
          status: "idle",
          cursor: 0,
          pendingMessages: 0,
          pendingInteractions: 0,
          attachments: 1,
          modelAvailable: true,
        },
      }),
      model: "deepseek-v4-flash",
    });
    expect(line).toContain("测试产品");
    expect(line).toContain("已连接(local)");
    expect(line).toContain("/work");
    expect(line).toContain("deepseek-v4-flash");
    expect(line).toContain("会话 2");
  });

  it("只读挂载被显式标出（否则「发了没反应」会被当成 bug）", () => {
    const line = statusLine({
      productName: "测试产品",
      connected: true,
      trustLevel: "local",
      sessionCount: 1,
      view: emptyView({ readOnly: true }),
      model: null,
    });
    expect(line).toContain("只读挂载");
  });
});

describe("会话选择列表", () => {
  it("标出当前会话", () => {
    const sessions: SessionSummary[] = [
      {
        id: "a",
        cwd: "/a",
        name: "甲",
        file: "",
        createdAt: "",
        updatedAt: "",
        entryCount: 0,
        firstMessage: null,
        owned: true,
        archived: false,
      },
      {
        id: "b",
        cwd: "/b",
        name: null,
        file: "",
        createdAt: "",
        updatedAt: "",
        entryCount: 0,
        firstMessage: null,
        owned: false,
        archived: false,
      },
    ];
    const items = sessionItems(sessions, "b");
    expect(items[0]?.label.startsWith("*")).toBe(false);
    expect(items[1]?.label.startsWith("*")).toBe(true);
    expect(items[1]?.label).toContain("/b");
  });
});

describe("帮助", () => {
  it("列出可用命令", () => {
    const text = helpText();
    for (const command of COMMAND_SPECS.map((spec) => spec.name)) {
      expect(text).toContain(command);
    }
  });
});

describe("命令提示", () => {
  it("输入 / 时列出全部命令", () => {
    expect(commandSuggestions("/").length).toBe(COMMAND_SPECS.length);
  });

  it("按前缀过滤", () => {
    const names = commandSuggestions("/m").map((spec) => spec.name);
    expect(names).toContain("/model");
    expect(names).not.toContain("/help");
  });

  it("已经进入参数后不再提示（否则会盖住用户要看的内容）", () => {
    expect(commandSuggestions("/model ds-proxy/")).toEqual([]);
    expect(commandSuggestions("普通消息")).toEqual([]);
  });

  it("提示里的命令都在帮助里出现过（两处不能各写一份）", () => {
    const help = helpText();
    for (const spec of commandSuggestions("/")) expect(help).toContain(spec.name);
  });
});

describe("常驻提示与告警", () => {
  it("键位提示随忙闲切换", () => {
    expect(hintLine({ running: false, streaming: false })).toContain("输入 / 查看命令");
    expect(hintLine({ running: true, streaming: true })).toContain("生成中");
  });

  it("没有可用模型时显式说出该怎么办（这正是「发了没反应」的成因之一）", () => {
    const text = bannerFor({
      connected: true,
      view: emptyView({ state: { modelAvailable: false } as never }),
      notices: [],
    });
    expect(text).toContain("还没有可用的模型");
    expect(text).toContain("/provider");
  });

  it("错误优先于其它提示", () => {
    const text = bannerFor({
      connected: false,
      view: emptyView(),
      notices: [{ level: "error", message: "发送失败：模型不存在" }],
    });
    expect(text).toContain("发送失败：模型不存在");
  });

  it("没有问题时不出提示", () => {
    expect(
      bannerFor({
        connected: true,
        view: emptyView({ state: { modelAvailable: true } as never }),
        notices: [],
      }),
    ).toBeNull();
  });
});

describe("流式尾部", () => {
  it("不重复渲染：总量由 toDisplayItems 决定，本层不再补一遍", () => {
    const view = emptyView({
      entries: [
        {
          id: "a1",
          timestamp: "t",
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "已经落盘的答复" }] },
        } as unknown as SessionView["entries"][number],
      ],
      seqByEntryId: { a1: 1 },
      maxSeq: 1,
      streaming: { text: "还没落盘的尾巴", thinking: "" },
    });
    const rendered = transcriptLines(view, { width: 80 }).join("\n");
    // 落盘的那条只出现一次；流式尾巴各出现一次。
    expect(rendered.split("已经落盘的答复").length - 1).toBe(1);
    expect(rendered.split("还没落盘的尾巴").length - 1).toBe(1);
  });
});
