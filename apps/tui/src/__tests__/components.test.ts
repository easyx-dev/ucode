import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { type FrameEditor, PromptFrame, RawLines } from "../components.ts";

/** 去掉 ANSI 只看文字。 */
const plain = (text: string): string => stripTerminalSequences(text);

/**
 * 假编辑器：按基座 `Editor.render` 的形状吐行
 * （上边框标记、正文、下边框标记、补全列表），用来单测外框的排版。
 */
function fakeEditor(rows: {
  body?: string[];
  autocomplete?: string[];
  hiddenAbove?: number;
}): FrameEditor & { input: string[] } {
  return {
    focused: false,
    hiddenAbove: rows.hiddenAbove ?? 0,
    input: [],
    render: () => [
      "\u0000frame:top\u0000",
      ...(rows.body ?? [" 输入内容"]),
      "\u0000frame:bottom\u0000",
      ...(rows.autocomplete ?? []),
    ],
    handleInput(data: string) {
      this.input.push(data);
    },
    invalidate() {},
  };
}

describe("RawLines", () => {
  it("原样输出已排版的行（不二次折行）", () => {
    const lines = ["已经算好宽度的一行", "第二行"];
    expect(new RawLines(lines).render()).toEqual(lines);
  });

  it("setLines 之后就换内容（流式更新靠它，不重建组件）", () => {
    const node = new RawLines(["旧"]);
    node.setLines(["新"]);
    expect(node.render()).toEqual(["新"]);
  });
});

describe("PromptFrame", () => {
  const frame = (rows: Parameters<typeof fakeEditor>[0], hint = "Enter 发送"): PromptFrame =>
    new PromptFrame({
      editor: fakeEditor(rows),
      label: () => "输入",
      hint: () => hint,
    });

  it("把正文框进方框，宽度与传给它的宽度一致", () => {
    const lines = frame({ body: [" 你好"] }).render(40);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
  });

  it("顶边带提示符与标签，底边带按键提示", () => {
    const lines = frame({ body: [" 你好"] }, "Enter 发送").render(40);
    expect(plain(lines[0] ?? "")).toContain("❯ 输入");
    expect(plain(lines.at(-1) ?? "")).toContain("Enter 发送");
  });

  it("补全菜单落在框内（视线不用跳出去）", () => {
    const lines = frame({ body: [" /"], autocomplete: ["/help  显示帮助"] }).render(50);
    const body = lines.slice(1, -1).map(plain).join("\n");
    expect(body).toContain("/help");
    expect(plain(lines.at(-1) ?? "")).toContain("╰");
  });

  it("编辑器向上滚动时在顶边提示还有多少行", () => {
    const lines = frame({ body: [" 内容"], hiddenAbove: 3 }).render(40);
    expect(plain(lines[0] ?? "")).toContain("↑3");
  });

  it("窄屏时提示被截断，方框不变形", () => {
    const lines = frame({ body: [" x"] }, "Enter 发送 · Shift+Enter 换行 · / 命令").render(20);
    for (const line of lines) expect(visibleWidth(line)).toBe(20);
  });

  it("焦点转发给里面真正的编辑器（否则输入法候选框会飘）", () => {
    const editor = fakeEditor({});
    const wrapped = new PromptFrame({ editor, label: () => "输入", hint: () => "" });
    wrapped.focused = true;
    expect(editor.focused).toBe(true);
    wrapped.handleInput("a");
    expect(editor.input).toEqual(["a"]);
  });
});
