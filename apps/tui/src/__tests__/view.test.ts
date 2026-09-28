import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { DisplayItem, SessionSummary, SessionView } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  bannerBox,
  bannerFor,
  buildLine,
  COMMAND_SPECS,
  commandSuggestions,
  compactionLine,
  emptyLine,
  footerLine,
  formatDuration,
  formatTokens,
  helpText,
  interactionPrompt,
  isStreaming,
  noticeLine,
  padLine,
  pendingBlock,
  promptHint,
  sessionItems,
  shortenCwd,
  thinkingLine,
  toolBlock,
  toolHead,
  turnStartedAt,
  userBlock,
} from "../view.ts";

/** 去掉 ANSI 只看文字（断言内容时不受配色影响）。 */
const plain = (text: string): string => stripTerminalSequences(text);

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

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;

function tool(over: Partial<ToolItem> = {}): ToolItem {
  return {
    kind: "tool",
    id: "t1",
    seq: 1,
    callId: "c1",
    toolName: "bash",
    args: { command: "ls -la" },
    status: "done",
    output: "",
    timestamp: "",
    ...over,
  };
}

describe("padLine", () => {
  it("按可见宽度补齐（方框右边框才对得齐）", () => {
    expect(padLine("ab", 5)).toBe("ab   ");
  });

  it("超宽就截断，不会把方框撑破", () => {
    expect(visibleWidth(padLine("abcdef", 3))).toBe(3);
  });

  it("中文按两列算", () => {
    expect(visibleWidth(padLine("中文", 6))).toBe(6);
  });
});

describe("userBlock", () => {
  it("每行带左侧色条", () => {
    const lines = userBlock("你好", 40);
    expect(lines).toHaveLength(1);
    expect(plain(lines[0] ?? "")).toBe("▌ 你好");
  });

  it("多行输入逐行保持色条（粘贴的代码块不会歪）", () => {
    const lines = userBlock("第一行\n第二行", 40);
    expect(lines.map(plain)).toEqual(["▌ 第一行", "▌ 第二行"]);
  });

  it("超长行折行后仍然每行都有色条", () => {
    const lines = userBlock("字".repeat(60), 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(plain(line).startsWith("▌")).toBe(true);
  });
});

describe("toolHead", () => {
  it("命令类带 $ 前缀", () => {
    expect(toolHead(tool())).toBe("$ ls -la");
  });

  it("文件类给路径", () => {
    expect(toolHead(tool({ toolName: "read", args: { path: "/a/b.ts" } }))).toBe("/a/b.ts");
  });

  it("搜索类给出模式与范围", () => {
    expect(toolHead(tool({ toolName: "grep", args: { pattern: "TODO", path: "src" } }))).toBe(
      "TODO · src",
    );
  });

  it("不认识的参数退化成参数名列表", () => {
    expect(toolHead(tool({ toolName: "custom", args: { a: 1, b: 2 } }))).toBe("a · b");
  });

  it("完全没有参数时退回工具名（不能是空行）", () => {
    expect(toolHead(tool({ toolName: "custom", args: {} }))).toBe("custom");
  });
});

describe("toolBlock", () => {
  it("画成方框：顶边带工具名与状态，底边闭合", () => {
    const lines = toolBlock(tool({ output: "a.ts" }), 40);
    expect(plain(lines[0] ?? "")).toContain("bash");
    expect(plain(lines[0] ?? "")).toContain("完成");
    expect(plain(lines[0] ?? "").startsWith("╭")).toBe(true);
    expect(plain(lines.at(-1) ?? "").startsWith("╰")).toBe(true);
  });

  it("每一行的可见宽度都一样（终端里方框才不会斜）", () => {
    const lines = toolBlock(tool({ output: "第一行\n第二行" }), 40);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
  });

  it("输出只留尾部，并说出省掉了多少行", () => {
    const output = Array.from({ length: 20 }, (_, index) => `第${index}行`).join("\n");
    const text = plain(toolBlock(tool({ output }), 40).join("\n"));
    expect(text).toContain("省略前 8 行");
    expect(text).toContain("第19行");
    expect(text).not.toContain("第0行");
  });

  it("出错时右上角标出错，不装成成功", () => {
    const text = plain(toolBlock(tool({ status: "error", output: "boom" }), 40).join("\n"));
    expect(text).toContain("出错");
    expect(text).toContain("boom");
  });

  it("运行中给出运行态（还没有输出也能看出在跑）", () => {
    expect(plain(toolBlock(tool({ status: "running" }), 40).join("\n"))).toContain("运行中");
  });
});

describe("thinkingLine", () => {
  it("压成一行并给出总行数", () => {
    const line = plain(
      thinkingLine({ kind: "thinking", id: "t", seq: 1, text: "甲\n乙\n丙", timestamp: "" }, 60),
    );
    expect(line).toContain("思考");
    expect(line).toContain("3 行");
    expect(line).toContain("甲");
  });

  it("超出宽度时截断而不是撑破布局", () => {
    const item = {
      kind: "thinking" as const,
      id: "t",
      seq: 1,
      text: "字".repeat(200),
      timestamp: "",
    };
    expect(visibleWidth(thinkingLine(item, 30))).toBeLessThanOrEqual(30);
  });
});

describe("noticeLine", () => {
  it("按级别换标记与颜色", () => {
    expect(plain(noticeLine("好了", 40, "info"))).toBe("· 好了");
    expect(plain(noticeLine("当心", 40, "warn"))).toBe("! 当心");
    expect(plain(noticeLine("炸了", 40, "error"))).toBe("✗ 炸了");
  });
});

describe("compactionLine", () => {
  it("作为分隔线呈现，带上摘要", () => {
    const line = plain(compactionLine("前面聊了很多", 40));
    expect(line).toContain("上下文已压缩");
    expect(line).toContain("前面聊了很多");
  });
});

describe("pendingBlock", () => {
  it("列出选项，而不是把 JSON 倒在屏幕上", () => {
    const text = plain(
      pendingBlock(
        {
          kind: "pending",
          id: "p",
          seq: 1,
          interactionId: "i1",
          method: "select",
          params: { title: "允许执行 bash？", options: ["允许一次", "拒绝"] },
          timestamp: "",
        },
        50,
      ).join("\n"),
    );
    expect(text).toContain("允许执行 bash？");
    expect(text).toContain("允许一次 / 拒绝");
    expect(text).toContain("待决交互");
  });

  it("缺字段也不崩（用 method 兜底）", () => {
    const text = plain(
      pendingBlock(
        {
          kind: "pending",
          id: "p",
          seq: 1,
          interactionId: "i",
          method: "confirm",
          params: {},
          timestamp: "",
        },
        40,
      ).join("\n"),
    );
    expect(text).toContain("confirm");
  });
});

describe("formatDuration", () => {
  it("一分钟以内报秒（带一位小数）", () => {
    expect(formatDuration(12_340)).toBe("12.3s");
  });

  it("超过一分钟报分秒", () => {
    expect(formatDuration(123_000)).toBe("2分03秒");
  });

  it("非法值给空串（宁可少显示，也不显示 NaN）", () => {
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(-1)).toBe("");
  });
});

describe("formatTokens", () => {
  it("大数缩写", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(2_345_678)).toBe("2.35M");
  });

  it("零与非法值都给 0", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("buildLine", () => {
  it("给出模型、耗时与队列", () => {
    const line = plain(
      buildLine(
        {
          model: "deepseek-v4-flash",
          startedAt: "2026-01-01T00:00:00.000Z",
          now: Date.parse("2026-01-01T00:00:12.300Z"),
          queued: 2,
          streaming: true,
        },
        80,
      ),
    );
    expect(line).toContain("生成中");
    expect(line).toContain("deepseek-v4-flash");
    expect(line).toContain("12.3s");
    expect(line).toContain("队列 2");
  });

  it("没有开始时间就不显示耗时（不猜）", () => {
    const line = plain(
      buildLine({ model: null, startedAt: null, now: Date.now(), queued: 0, streaming: false }, 80),
    );
    expect(line).toContain("运行中");
    expect(line).not.toContain("s ·");
  });
});

describe("footerLine", () => {
  it("左对齐目录、右对齐模型与用量，总宽不超过终端", () => {
    const line = footerLine(
      {
        cwd: "/Users/lyy/code/demo-app",
        autonomy: "full-access",
        model: "deepseek-v4-flash",
        tokens: 419_100,
        sessionCount: 3,
        connected: true,
        trustLevel: "local",
        readOnly: false,
        hint: "/ 命令",
      },
      100,
    );
    const text = plain(line);
    expect(visibleWidth(line)).toBeLessThanOrEqual(100);
    expect(text.startsWith("/Users/lyy/code/demo-app")).toBe(true);
    expect(text.trimEnd().endsWith("/ 命令")).toBe(true);
    expect(text).toContain("完全访问");
    expect(text).toContain("419.1k tokens");
  });

  it("未连接与只读挂载必须显式（否则「发了没反应」会被当成 bug）", () => {
    const text = plain(
      footerLine(
        {
          cwd: "/w",
          autonomy: null,
          model: null,
          tokens: null,
          sessionCount: 0,
          connected: false,
          trustLevel: null,
          readOnly: true,
        },
        80,
      ),
    );
    expect(text).toContain("未连接");
    expect(text).toContain("只读挂载");
  });

  it("窄屏时先丢装饰（会话数、信任级别），保住路径与用量", () => {
    const line = footerLine(
      {
        cwd: "/very/long/path/to/the/project/directory",
        autonomy: "confirm",
        model: "some-model",
        tokens: 1234,
        sessionCount: 9,
        connected: true,
        trustLevel: "local",
        readOnly: false,
        hint: "/ 命令",
      },
      60,
    );
    const text = plain(line);
    expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    expect(text).toContain("/very/long");
    expect(text).not.toContain("9 会话");
    // 模型是"我到底在用哪个"的答案，比执行模式更该留住。
    expect(text).toContain("some-model");
  });

  it("极窄屏：截路径也要留下命令入口（否则用户不知道还能输命令）", () => {
    const line = footerLine(
      {
        cwd: "/very/long/path/to/the/project/directory",
        home: "/very",
        autonomy: "confirm",
        model: "some-model",
        tokens: 1234,
        sessionCount: 9,
        connected: true,
        trustLevel: "local",
        readOnly: false,
        hint: "/ 命令",
      },
      40,
    );
    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(plain(line)).toContain("/ 命令");
  });

  it("家目录缩写成 ~（省下的宽度给用量）", () => {
    const line = footerLine(
      {
        cwd: "/Users/lyy/code/demo-app",
        home: "/Users/lyy",
        autonomy: null,
        model: null,
        tokens: null,
        sessionCount: 0,
        connected: true,
        trustLevel: "local",
        readOnly: false,
      },
      80,
    );
    expect(plain(line).startsWith("~/code/demo-app")).toBe(true);
  });
});

describe("shortenCwd", () => {
  it("家目录前缀换成 ~", () => {
    expect(shortenCwd("/Users/lyy/code/demo-app", "/Users/lyy")).toBe("~/code/demo-app");
  });

  it("就是家目录本身时是单个 ~", () => {
    expect(shortenCwd("/Users/lyy", "/Users/lyy")).toBe("~");
  });

  it("不在家目录下就原样返回（不猜）", () => {
    expect(shortenCwd("/srv/app", "/Users/lyy")).toBe("/srv/app");
  });

  it("拿不到家目录时不动路径", () => {
    expect(shortenCwd("/Users/lyy/code/demo-app", undefined)).toBe("/Users/lyy/code/demo-app");
  });
});

describe("bannerBox", () => {
  it("画成一个醒目的方框，长文本折行", () => {
    const lines = bannerBox("还没有可用的模型：用 /provider 添加一个供应商。", 40);
    expect(plain(lines[0] ?? "")).toContain("注意");
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(lines.length).toBeGreaterThan(2);
  });
});

describe("emptyLine", () => {
  it("空会话给出引导语", () => {
    expect(plain(emptyLine(60))).toContain("还没有对话");
  });
});

describe("promptHint", () => {
  it("忙时只提示还能按什么", () => {
    expect(promptHint({ running: true, answering: false })).toContain("排队");
    expect(promptHint({ running: true, answering: false })).not.toContain("Tab 补全");
  });

  it("回答提问时提示回车是提交", () => {
    expect(promptHint({ running: false, answering: true })).toContain("提交回答");
  });

  it("闲时给完整键位", () => {
    expect(promptHint({ running: false, answering: false })).toContain("Shift+Enter");
  });
});

describe("turnStartedAt", () => {
  it("取最后一条用户消息的时间戳", () => {
    const view = emptyView({
      entries: [
        {
          id: "u1",
          timestamp: "2026-01-01T00:00:01.000Z",
          type: "message",
          message: { role: "user", content: "第一句" },
        } as unknown as SessionView["entries"][number],
        {
          id: "u2",
          timestamp: "2026-01-01T00:00:09.000Z",
          type: "message",
          message: { role: "user", content: "第二句" },
        } as unknown as SessionView["entries"][number],
      ],
      seqByEntryId: { u1: 1, u2: 2 },
      maxSeq: 2,
    });
    expect(turnStartedAt(view)).toBe("2026-01-01T00:00:09.000Z");
  });

  it("没有用户消息时返回 null（不编造耗时）", () => {
    expect(turnStartedAt(emptyView())).toBeNull();
    expect(turnStartedAt(null)).toBeNull();
  });
});

describe("isStreaming", () => {
  it("有流式正文时为真", () => {
    expect(isStreaming(emptyView({ streaming: { text: "在写", thinking: "" } }))).toBe(true);
    expect(isStreaming(emptyView())).toBe(false);
  });
});

describe("interactionPrompt", () => {
  const request = (method: string, params: Record<string, unknown>) =>
    ({
      type: "ui.request",
      id: "r1",
      sessionId: "s1",
      method,
      params,
      origin: "permission",
    }) as never;

  it("select 出选项列表（工具批准就是这一档）", () => {
    expect(
      interactionPrompt(
        request("select", { title: "允许执行 bash？", options: ["允许一次", "拒绝"] }),
      ),
    ).toEqual({ kind: "select", title: "允许执行 bash？", options: ["允许一次", "拒绝"] });
  });

  it("select 没给选项就不弹（避免弹出空列表）", () => {
    expect(interactionPrompt(request("select", { title: "x", options: [] }))).toBeNull();
  });

  it("confirm 出允许/拒绝二选一", () => {
    expect(interactionPrompt(request("confirm", { title: "确认", message: "要删除吗？" }))).toEqual(
      {
        kind: "confirm",
        title: "确认",
        message: "要删除吗？",
      },
    );
  });

  it("input / editor 走自由输入，并带上提示语与预填", () => {
    expect(interactionPrompt(request("input", { title: "去哪？", placeholder: "城市" }))).toEqual({
      kind: "input",
      title: "去哪？",
      placeholder: "城市",
      prefill: null,
    });
    expect(interactionPrompt(request("editor", { title: "改写", prefill: "原文" }))).toMatchObject({
      kind: "input",
      prefill: "原文",
    });
  });

  it("缺字段时给可读的兜底，而不是 undefined", () => {
    expect(interactionPrompt(request("select", { options: ["甲"] }))).toMatchObject({
      title: "需要你确认",
    });
  });
});

describe("sessionItems", () => {
  it("标出当前会话并带上目录", () => {
    const sessions: SessionSummary[] = [
      {
        id: "a",
        cwd: "/a",
        name: "甲",
        createdAt: "",
        updatedAt: "",
        entryCount: 0,
        firstMessage: null,
        archived: false,
      },
      {
        id: "b",
        cwd: "/b",
        name: null,
        createdAt: "",
        updatedAt: "",
        entryCount: 0,
        firstMessage: null,
        archived: false,
      },
    ];
    const items = sessionItems(sessions, "b");
    expect(items[0]?.label.startsWith("▸")).toBe(false);
    expect(items[1]?.label.startsWith("▸")).toBe(true);
    expect(items[1]?.label).toContain("/b");
  });
});

describe("helpText", () => {
  it("列出可用命令", () => {
    const text = helpText();
    for (const command of COMMAND_SPECS.map((spec) => spec.name)) {
      expect(text).toContain(command);
    }
  });
});

describe("commandSuggestions", () => {
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

describe("bannerFor", () => {
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
