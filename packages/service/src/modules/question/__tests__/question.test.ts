import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { askUser, questionTool } from "../extension.ts";

/** 只关心这四个方法；其余留给基座（测试里用不到）。 */
function fakeUi(partial: Partial<ExtensionUIContext>): ExtensionUIContext {
  return partial as ExtensionUIContext;
}

describe("askUser", () => {
  it("给了选项就走选择，并把选择结果交回模型", async () => {
    const outcome = await askUser(fakeUi({ select: async () => "方案 B" }), {
      question: "选哪个？",
      options: ["方案 A", "方案 B"],
    });
    expect(outcome.text).toContain("方案 B");
    expect(outcome.details).toEqual({ question: "选哪个？", mode: "choose", answer: "方案 B" });
  });

  it("没有选项就走自由输入，并去掉首尾空白", async () => {
    const outcome = await askUser(fakeUi({ input: async () => "  东京  " }), {
      question: "去哪？",
    });
    expect(outcome.details.mode).toBe("freeform");
    expect(outcome.details.answer).toBe("东京");
  });

  it("没人应答时明确报错，而不是返回空答案", async () => {
    await expect(
      askUser(fakeUi({ select: async () => undefined }), { question: "选哪个？", options: ["A"] }),
    ).rejects.toThrow(/最佳判断/);
  });

  it("自由输入为空同样算没答", async () => {
    await expect(askUser(fakeUi({ input: async () => "   " }), { question: "q" })).rejects.toThrow(
      /没有得到回答/,
    );
  });

  it("没有可承载交互的通路时报错（并告诉模型自己判断）", async () => {
    await expect(askUser(undefined, { question: "q" })).rejects.toThrow(/没有可承载交互的界面/);
  });

  it("选项过多时拒绝，让模型自己收窄", async () => {
    await expect(
      askUser(fakeUi({ select: async () => "A" }), {
        question: "q",
        options: ["1", "2", "3", "4", "5", "6", "7"],
      }),
    ).rejects.toThrow(/最多 6 项/);
  });

  it("空问题被拒", async () => {
    await expect(askUser(fakeUi({ input: async () => "x" }), { question: "   " })).rejects.toThrow(
      /不能为空/,
    );
  });
});

describe("questionTool", () => {
  it("把 ui 的回答包装成 pi 的工具结果", async () => {
    const result = await questionTool.execute(
      "call-1",
      { question: "继续吗？", options: ["继续", "停下"] },
      undefined,
      undefined,
      { ui: fakeUi({ select: async () => "继续" }) },
    );
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("继续");
    expect(result.details.answer).toBe("继续");
  });
});
